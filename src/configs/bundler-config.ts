export const DEFAULT_ENTRY_POINT_ADDRESS = '0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789';

export const RPC_CONFIG = [
    {
        chainId: 100,
        rpcUrl: 'https://rpc.gnosischain.com',
    },
];

export const PARTICLE_PUBLIC_RPC_URL = 'https://rpc.particle.network/evm-chain/public';

export const BUNDLER_CONFIG: any = {
    default: {
        MAX_BUNDLE_GAS: 7000000,
        SUPPORTED_ENTRYPOINTS: ['0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789'],
    },
    '534351': {
        MAX_BUNDLE_GAS: 5000000,
    },
};

export const MINIMUM_GAS_FEE = {
    // '10200': { gasPrice: '0x5f5e100' },
    // '100': { gasPrice: '0x5f5e100' },
};
export const CHAIN_BALANCE_RANGE = {
    '100': 0.01,
};
export const CHAIN_SIGNER_MIN_BALANCE = {
    '100': 0.01,
};
