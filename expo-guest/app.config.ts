import type { ConfigContext, ExpoConfig } from 'expo/config';

// start.sh loads ../.env, so the dev API key reaches the app without being committed here.
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  extra: {
    apiKey: process.env.IOS_API_KEY ?? '',
    apiPort: process.env.EXPO_GUEST_API_PORT ?? '22674',
    // Set by ../tunnel.sh when the phone reaches the server through a public tunnel.
    apiUrl: process.env.EXPO_GUEST_API_URL ?? '',
  },
});
