import {CryptoProviderType} from '../types'
import CardanoWalletSecretCryptoProvider from './cardano-wallet-secret-crypto-provider'
import CardanoTrezorCryptoProvider from './cardano-trezor-crypto-provider'
import CardanoLedgerCryptoProvider from './cardano-ledger-crypto-provider'
import NamedError from '../../helpers/NamedError'

const CryptoProviderFactory = (() => {
  const getCryptoProvider = (cryptoProviderType, options) => {
    switch (cryptoProviderType) {
      case CryptoProviderType.TREZOR:
        return CardanoTrezorCryptoProvider(options)

      case CryptoProviderType.LEDGER:
        return CardanoLedgerCryptoProvider(options)

      case CryptoProviderType.WALLET_SECRET:
        return CardanoWalletSecretCryptoProvider(options)

      default:
        throw NamedError('CryptoProviderError', {
          message: `Unknown crypto provider type: ${cryptoProviderType}`,
        })
    }
  }

  return {
    getCryptoProvider,
  }
})()

export default CryptoProviderFactory
