import LedgerTransportU2F from '@ledgerhq/hw-transport-u2f'
import LedgerTransportWebusb from '@ledgerhq/hw-transport-webusb'
import Ledger, {AddressTypeNibbles} from '@cardano-foundation/ledgerjs-hw-app-cardano'
import {encode} from 'borc'
import CachedDeriveXpubFactory from '../helpers/CachedDeriveXpubFactory'
import debugLog from '../../helpers/debugLog'
import {ShelleySignedTransactionStructured, ShelleyTxWitnesses} from './shelley-transaction'
import * as platform from 'platform'
import {hasRequiredVersion} from './helpers/version-check'
import {PoolParams} from './helpers/poolCertificateUtils'
import {LEDGER_VERSIONS, LEDGER_ERRORS} from '../constants'
import {captureMessage} from '@sentry/browser'

import {
  bechAddressToHex,
  isShelleyPath,
  isShelleyFormat,
  base58AddressToHex,
} from './helpers/addresses'

import derivationSchemes from '../helpers/derivation-schemes'
import NamedError from '../../helpers/NamedError'
import {
  CryptoProvider,
  CryptoProviderFeature,
  BIP32Path,
  HexString,
  DerivationScheme,
  AddressToPathMapper,
} from '../../types'
import {
  Network,
  OutputType,
  _ByronWitness,
  _Certificate,
  _Input,
  _Output,
  _ShelleyWitness,
  _Withdrawal,
} from '../types'
import {
  LedgerCertificate,
  LedgerGetExtendedPublicKeyResponse,
  LedgerInput,
  LedgerOutput,
  LedgerSignTransactionResponse,
  LedgerWithdrawal,
  LedgerWitness,
} from './ledger-types'
import {_SignedTx, _TxAux} from './types'

const isWebUsbSupported = async () => {
  const isSupported = await LedgerTransportWebusb.isSupported()
  return isSupported && platform.os.family !== 'Windows' && platform.name !== 'Opera'
}

const getLedgerTransport = async (forceWebUsb: boolean): Promise<any> => {
  if (forceWebUsb) {
    return await LedgerTransportWebusb.create()
  }

  let transport
  try {
    const support = await isWebUsbSupported()
    if (support) {
      transport = await LedgerTransportWebusb.create()
    } else {
      transport = await LedgerTransportU2F.create()
    }
  } catch (hwTransportError) {
    // fallback to U2F in any case
    try {
      transport = await LedgerTransportU2F.create()
    } catch (u2fError) {
      debugLog(u2fError)
      captureMessage(
        JSON.stringify({
          u2fError: {name: u2fError.name, message: u2fError.message},
          hwTransportError: {name: hwTransportError.name, message: hwTransportError.message},
        })
      )
      throw hwTransportError
    }
  }

  return transport
}

type CryptoProviderParams = {
  network: Network
  config: any
  forceWebUsb: boolean
}

const ShelleyLedgerCryptoProvider = async ({
  network,
  config,
  forceWebUsb,
}: CryptoProviderParams): Promise<CryptoProvider> => {
  const transport = await getLedgerTransport(forceWebUsb)
  transport.setExchangeTimeout(config.ADALITE_LOGOUT_AFTER * 1000)
  const ledger = new Ledger(transport)
  const derivationScheme = derivationSchemes.v2

  const version = await ledger.getVersion()

  ensureFeatureIsSupported(CryptoProviderFeature.MINIMAL)

  const isHwWallet = () => true
  const getWalletName = () => 'Ledger'

  const exportPublicKeys = async (
    derivationPaths: BIP32Path[]
  ): Promise<LedgerGetExtendedPublicKeyResponse[]> => {
    if (isFeatureSupported(CryptoProviderFeature.BULK_EXPORT)) {
      return await ledger.getExtendedPublicKeys(derivationPaths)
    }
    const response: LedgerGetExtendedPublicKeyResponse[] = []
    for (const path of derivationPaths) {
      response.push(await ledger.getExtendedPublicKey(path))
    }
    return response
  }

  const deriveXpub = CachedDeriveXpubFactory(
    derivationScheme,
    config.shouldExportPubKeyBulk && isFeatureSupported(CryptoProviderFeature.BULK_EXPORT),
    async (derivationPaths: BIP32Path[]) => {
      const response = await exportPublicKeys(derivationPaths)
      return response.map((res) => Buffer.from(res.publicKeyHex + res.chainCodeHex, 'hex'))
    }
  )

  function isFeatureSupported(feature: CryptoProviderFeature): boolean {
    return LEDGER_VERSIONS[feature] ? hasRequiredVersion(version, LEDGER_VERSIONS[feature]) : true
  }

  function ensureFeatureIsSupported(feature: CryptoProviderFeature): void {
    if (!isFeatureSupported(feature)) {
      throw NamedError(LEDGER_ERRORS[feature], {
        message: `${version.major}.${version.minor}.${version.patch}`,
      })
    }
  }

  function getHdPassphrase(): void {
    throw NamedError('UnsupportedOperationError', {
      message: 'This operation is not supported on LedgerCryptoProvider!',
    })
  }

  function sign(message: HexString, absDerivationPath: BIP32Path): void {
    throw NamedError('UnsupportedOperationError', {message: 'Operation not supported'})
  }

  async function displayAddressForPath(
    absDerivationPath: BIP32Path,
    stakingPath?: BIP32Path
  ): Promise<void> {
    try {
      await ledger.showAddress(
        AddressTypeNibbles.BASE,
        network.networkId,
        absDerivationPath,
        stakingPath
      )
    } catch (err) {
      throw NamedError('LedgerOperationError', {message: `${err.name}: ${err.message}`})
    }
  }

  function getWalletSecret(): void {
    throw NamedError('UnsupportedOperationError', {message: 'Unsupported operation!'})
  }

  function getDerivationScheme(): DerivationScheme {
    return derivationScheme
  }

  function prepareInput(input: _Input, addressToAbsPathMapper: AddressToPathMapper): LedgerInput {
    return {
      txHashHex: input.txHash,
      outputIndex: input.outputIndex,
      path: input.address ? addressToAbsPathMapper(input.address) : null,
    }
  }

  function prepareOutput(output: _Output): LedgerOutput {
    return output.type === OutputType.NO_CHANGE
      ? {
        amountStr: `${output.coins}`,
        addressHex: isShelleyFormat(output.address)
          ? bechAddressToHex(output.address)
          : base58AddressToHex(output.address),
        tokenBundle: [],
      }
      : {
        amountStr: `${output.coins}`,
        tokenBundle: [],
        addressTypeNibble: 0,
        spendingPath: output.spendingPath,
        stakingPath: output.stakingPath,
      }
  }

  function prepareCertificate(
    certificate: _Certificate,
    addressToAbsPathMapper: AddressToPathMapper
  ): LedgerCertificate {
    return {
      type: certificate.type,
      // path:
      //   certificate.type !== CertificateType.STAKEPOOL_REGISTRATION
      //     ? addressToAbsPathMapper(certificate.accountAddress)
      //     : null,
      path: addressToAbsPathMapper(certificate.stakingAddress),
      poolKeyHashHex: certificate.poolHash,
      poolRegistrationParams: certificate.poolRegistrationParams,
    }
  }

  function prepareWithdrawal(
    withdrawal: _Withdrawal,
    addressToAbsPathMapper: AddressToPathMapper
  ): LedgerWithdrawal {
    return {
      path: addressToAbsPathMapper(withdrawal.stakingAddress),
      amountStr: `${withdrawal.rewards}`,
    }
  }

  const xpub2pub = (xpub: Buffer) => xpub.slice(0, 32) // TODO: export from addresses

  const prepareByronWitness = async (witness: LedgerWitness): Promise<_ByronWitness> => {
    const xpub = await deriveXpub(witness.path)
    const publicKey = xpub2pub(xpub)
    const chainCode = xpub.slice(32, 64) // TODO: xpub to chainCode helper
    // TODO: unless we create pathToAddressMapper we cant get this from cardano-crypto
    const addressAttributes = encode({})
    const signature = Buffer.from(witness.witnessSignatureHex, 'hex')
    return {
      publicKey,
      signature,
      chainCode,
      addressAttributes,
    }
  }

  const prepareShelleyWitness = async (witness: LedgerWitness): Promise<_ShelleyWitness> => {
    const xpub = await deriveXpub(witness.path)
    const publicKey = xpub2pub(xpub)
    const signature = Buffer.from(witness.witnessSignatureHex, 'hex')
    return {
      publicKey,
      signature,
    }
  }

  const prepareWitnesses = async (ledgerWitnesses: LedgerWitness[]) => {
    const _shelleyWitnesses = []
    const _byronWitnesses = []
    ledgerWitnesses.forEach((witness) => {
      isShelleyPath(witness.path)
        ? _shelleyWitnesses.push(prepareShelleyWitness(witness))
        : _byronWitnesses.push(prepareByronWitness(witness))
    })
    const shelleyWitnesses: _ShelleyWitness[] = await Promise.all(_shelleyWitnesses)
    const byronWitnesses: _ByronWitness[] = await Promise.all(_byronWitnesses)
    return {shelleyWitnesses, byronWitnesses}
  }

  async function signTx(
    txAux: _TxAux,
    addressToAbsPathMapper: AddressToPathMapper
  ): Promise<_SignedTx> {
    const inputs = txAux.inputs.map((input) => prepareInput(input, addressToAbsPathMapper))
    const outputs = txAux.outputs.map((output) => prepareOutput(output))
    const certificates = txAux.certificates.map((certificate) =>
      prepareCertificate(certificate, addressToAbsPathMapper)
    )
    const feeStr = `${txAux.fee}`
    const ttlStr = `${txAux.ttl}`
    const withdrawals = txAux.withdrawals.map((withdrawal) =>
      prepareWithdrawal(withdrawal, addressToAbsPathMapper)
    )

    const response: LedgerSignTransactionResponse = await ledger.signTransaction(
      network.networkId,
      network.protocolMagic,
      inputs,
      outputs,
      feeStr,
      ttlStr,
      certificates,
      withdrawals
    )

    if (response.txHashHex !== txAux.getId()) {
      throw NamedError('TxSerializationError', {
        message: 'Tx serialization mismatch between Ledger and Adalite',
      })
    }

    const txMeta = null
    const {shelleyWitnesses, byronWitnesses} = await prepareWitnesses(response.witnesses)
    const txWitnesses = ShelleyTxWitnesses(byronWitnesses, shelleyWitnesses)
    const structuredTx = ShelleySignedTransactionStructured(txAux, txWitnesses, txMeta)

    return {
      txHash: response.txHashHex,
      txBody: encode(structuredTx).toString('hex'),
    }
  }

  return {
    network,
    getWalletSecret,
    getDerivationScheme,
    signTx,
    getHdPassphrase,
    displayAddressForPath,
    deriveXpub,
    isHwWallet,
    getWalletName,
    _sign: sign,
    isFeatureSupported,
    ensureFeatureIsSupported,
  }
}

export default ShelleyLedgerCryptoProvider
