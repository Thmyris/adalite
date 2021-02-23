// eslint-disable-next-line import/no-unresolved
import CachedDeriveXpubFactory from '../helpers/CachedDeriveXpubFactory'
import {ADALITE_SUPPORT_EMAIL, TREZOR_ERRORS, TREZOR_VERSIONS} from '../constants'
import derivationSchemes from '../helpers/derivation-schemes'
import NamedError from '../../helpers/NamedError'
import debugLog from '../../helpers/debugLog'
import {bech32, AddressTypes} from 'cardano-crypto.js'
import {hasRequiredVersion} from './helpers/version-check'
import {
  CryptoProvider,
  CertificateType,
  CryptoProviderFeature,
  BIP32Path,
  HexString,
  AddressToPathMapper,
} from '../../types'
import {Network, OutputType, _Certificate, _Input, _Output, _Withdrawal} from '../types'
import {
  TrezorAddressParameters,
  TrezorGetAddressResponse,
  TrezorGetPublicKeyResponse,
  TrezorInput,
  TrezorOutput,
  TrezorSignTxResponse,
  TrezorTxCertificate,
  TrezorWithdrawal,
} from './trezor-types'
import {_SignedTx, _TxAux} from './types'

type CryptoProviderParams = {
  network: Network
  config: any
}

const ShelleyTrezorCryptoProvider = async ({
  network,
  config,
}: CryptoProviderParams): Promise<CryptoProvider> => {
  const derivationScheme = derivationSchemes.v2

  const TrezorConnect = require('trezor-connect').default

  TrezorConnect.manifest({
    email: ADALITE_SUPPORT_EMAIL,
    appUrl: config.ADALITE_SERVER_URL,
  })

  const getVersion = async (): Promise<any> => {
    // TODO: add return type
    const {payload: features} = await TrezorConnect.getFeatures()
    const {major_version: major, minor_version: minor, patch_version: patch} = features
    return {major, minor, patch}
  }

  const version = await getVersion()

  const isHwWallet = (): boolean => true
  const getWalletName = (): string => 'Trezor' // TODO: return enum

  const deriveXpub = CachedDeriveXpubFactory(
    derivationScheme,
    config.shouldExportPubKeyBulk,
    async (absDerivationPaths: BIP32Path[]) => {
      const bundle = absDerivationPaths.map((path: BIP32Path) => ({path, showOnTrezor: false}))
      const response: TrezorGetPublicKeyResponse = await TrezorConnect.cardanoGetPublicKey({
        bundle,
      })
      if (response.success === false) {
        throw NamedError('TrezorError', {message: response.payload.error})
      }
      return response.payload.map(({publicKey}) => Buffer.from(publicKey, 'hex'))
    }
  )

  function isFeatureSupported(feature: CryptoProviderFeature): boolean {
    return TREZOR_VERSIONS[feature] ? hasRequiredVersion(version, TREZOR_VERSIONS[feature]) : true
  }

  function ensureFeatureIsSupported(feature: CryptoProviderFeature): void {
    if (!isFeatureSupported(feature)) {
      throw NamedError(TREZOR_ERRORS[feature], {
        message: `${version.major}.${version.minor}.${version.patch}`,
      })
    }
  }

  function getHdPassphrase(): void {
    throw NamedError('UnsupportedOperationError', {
      message: 'This operation is not supported on TrezorCryptoProvider!',
    })
  }

  function sign(message: HexString, absDerivationPath: BIP32Path): void {
    throw NamedError('UnsupportedOperationError', {message: 'Operation not supported'})
  }

  async function displayAddressForPath(
    absDerivationPath: BIP32Path,
    stakingPath?: BIP32Path
  ): Promise<void> {
    const addressParameters: TrezorAddressParameters = {
      addressType: AddressTypes.BASE, // TODO: retrieve from address
      path: absDerivationPath,
      stakingPath,
    }
    const response: TrezorGetAddressResponse = await TrezorConnect.cardanoGetAddress({
      addressParameters,
      networkId: network.networkId,
      protocolMagic: network.protocolMagic,
      showOnTrezor: true,
    })
    if (response.success === false) {
      throw NamedError('TrezorError', {message: response.payload.error})
    }
  }

  function prepareInput(input: _Input, addressToAbsPathMapper: AddressToPathMapper): TrezorInput {
    return {
      ...(input.address && {path: addressToAbsPathMapper(input.address)}),
      prev_hash: input.txHash,
      prev_index: input.outputIndex,
    }
  }

  function prepareTokenBundle() {
    return [] // TODO:
  }

  function prepareOutput(output: _Output): TrezorOutput {
    const tokenBundle = prepareTokenBundle()
    return output.type === OutputType.NO_CHANGE
      ? {
        address: output.address,
        amount: `${output.coins}`,
        tokenBundle,
      }
      : {
        amount: `${output.coins}`,
        addressParameters: {
          addressType: AddressTypes.BASE, // TODO: retrieve from the address
          path: output.spendingPath,
          stakingPath: output.stakingPath,
        },
        tokenBundle,
      }
  }

  function poolCertToTrezorFormat(cert) {
    return {
      poolId: cert.poolKeyHashHex,
      vrfKeyHash: cert.vrfKeyHashHex,
      pledge: cert.pledgeStr,
      cost: cert.costStr,
      margin: {
        numerator: cert.margin.numeratorStr,
        denominator: cert.margin.denominatorStr,
      },
      rewardAccount: bech32.encode('stake', Buffer.from(cert.rewardAccountHex, 'hex')),
      owners: cert.poolOwners.map((owner) => ({
        ...(owner.stakingKeyHashHex && {
          stakingKeyHash: owner.stakingKeyHashHex,
        }),
        ...(owner.stakingPath && {
          stakingKeyPath: owner.stakingPath,
          stakingKeyHash: undefined,
        }),
      })),
      relays: cert.relays.map((relay) => ({
        type: relay.type,
        ...(relay.type === 0 && {
          ipv4Address: relay.params.ipv4,
          ipv6Address: relay.params.ipv6,
        }),
        ...(relay.type < 2 && {port: relay.params.portNumber}),
        ...(relay.type > 0 && {hostName: relay.params.dnsName}),
      })),
      metadata: cert.metadata
        ? {
          url: cert.metadata.metadataUrl,
          hash: cert.metadata.metadataHashHex,
        }
        : null,
    }
  }

  function prepareStakingKeyRegistrationCertificate(
    certificate: _Certificate,
    path: BIP32Path
  ): TrezorTxCertificate {
    return {
      type: certificate.type,
      path,
    }
  }

  function prepareDelegationCertificate(
    certificate: _Certificate,
    path: BIP32Path
  ): TrezorTxCertificate {
    return {
      type: certificate.type,
      path,
      pool: certificate.poolHash,
    }
  }

  function preparePoolRegistrationCertificate(
    certificate: _Certificate,
    path: BIP32Path
  ): TrezorTxCertificate {
    return null // TODO:
  }

  // TODO: refactor this to switch with prepare function for each type of certificate
  function prepareCertificate(
    certificate: _Certificate,
    addressToAbsPathMapper: AddressToPathMapper
  ): TrezorTxCertificate {
    const path = addressToAbsPathMapper(certificate.stakingAddress)
    switch (certificate.type) {
      case CertificateType.STAKING_KEY_REGISTRATION:
        return prepareStakingKeyRegistrationCertificate(certificate, path)
      case CertificateType.DELEGATION:
        return prepareDelegationCertificate(certificate, path)
      case CertificateType.STAKEPOOL_REGISTRATION:
        return preparePoolRegistrationCertificate(certificate, path)
      default:
        throw NamedError('InvalidCertficateType')
    }
  }

  function prepareWithdrawal(
    withdrawal: _Withdrawal,
    addressToAbsPathMapper: AddressToPathMapper
  ): TrezorWithdrawal {
    return {
      path: addressToAbsPathMapper(withdrawal.stakingAddress),
      amount: `${withdrawal.rewards}`,
    }
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
    const fee = `${txAux.fee}`
    const ttl = `${txAux.ttl}`
    const withdrawals = txAux.withdrawals.map((withdrawal) =>
      prepareWithdrawal(withdrawal, addressToAbsPathMapper)
    )

    const response: TrezorSignTxResponse = await TrezorConnect.cardanoSignTransaction({
      inputs,
      outputs,
      protocolMagic: network.protocolMagic,
      fee,
      ttl,
      networkId: network.networkId,
      certificates,
      withdrawals,
    })

    if (response.success === false) {
      debugLog(response)
      throw NamedError('TrezorSignTxError', {message: response.payload.error})
    }

    if (response.payload.hash !== txAux.getId()) {
      throw NamedError('TxSerializationError', {
        message: 'Tx serialization mismatch between Trezor and Adalite',
      })
    }

    return {
      txHash: response.payload.hash,
      txBody: response.payload.serializedTx,
    }
  }

  function getWalletSecret(): void {
    throw NamedError('UnsupportedOperationError', {message: 'Unsupported operation!'})
  }

  function getDerivationScheme() {
    return derivationScheme
  }

  return {
    getWalletSecret,
    getDerivationScheme,
    signTx,
    displayAddressForPath,
    deriveXpub,
    isHwWallet,
    getWalletName,
    _sign: sign,
    network,
    ensureFeatureIsSupported,
    isFeatureSupported,
    getHdPassphrase,
  }
}

export default ShelleyTrezorCryptoProvider
