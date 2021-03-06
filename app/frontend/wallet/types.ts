import {BIP32Path, CertificateType, Lovelace, Token, Address} from '../types'

export const enum NetworkId {
  MAINNET = 1,
  TESTNET = 0,
}

export const enum ProtocolMagic {
  MAINNET = 764824073,
  HASKELL_TESTNET = 42,
  MARY_TESTNET = 1097911063,
}

export type Network = {
  name: string
  networkId: NetworkId
  protocolMagic: ProtocolMagic
  eraStartSlot: number
  eraStartDateTime: number
  epochsToRewardDistribution: number
  minimalOutput: number
}

export const enum CryptoProviderType {
  LEDGER = 'LEDGER',
  TREZOR = 'TREZOR',
  WALLET_SECRET = 'WALLET_SECRET',
}

export type UTxO = {
  txHash: string
  address: Address
  coins: Lovelace
  tokens: Token[]
  outputIndex: number
}

export type TxInput = UTxO

export type TxOutput =
  | {
      isChange: false
      address: Address
      coins: Lovelace
      tokens: Token[]
    }
  | {
      isChange: true
      address: Address
      coins: Lovelace
      tokens: Token[]
      spendingPath: BIP32Path
      stakingPath: BIP32Path
    }

export type TxCertificate =
  | TxStakingKeyRegistrationCert
  | TxStakingKeyDeregistrationCert
  | TxDelegationCert
  | TxStakepoolRegistrationCert

export type TxStakingKeyRegistrationCert = {
  type: CertificateType.STAKING_KEY_REGISTRATION
  stakingAddress: Address
}

export type TxStakingKeyDeregistrationCert = {
  type: CertificateType.STAKING_KEY_DEREGISTRATION
  stakingAddress: Address
}

export type TxDelegationCert = {
  type: CertificateType.DELEGATION
  stakingAddress: Address
  poolHash: string
}

export type TxStakepoolRegistrationCert = {
  type: CertificateType.STAKEPOOL_REGISTRATION
  stakingAddress: Address
  poolRegistrationParams: any
}

export type TxWithdrawal = {
  stakingAddress: Address
  rewards: Lovelace
}

export type TxShelleyWitness = {
  publicKey: Buffer
  signature: Buffer
}

export type TxByronWitness = {
  publicKey: Buffer
  signature: Buffer
  chainCode: Buffer
  addressAttributes: any // TODO:
}
