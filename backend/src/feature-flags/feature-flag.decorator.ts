import { SetMetadata } from '@nestjs/common';

export const FEATURE_FLAG_KEY = 'feature_flag';

/** Mark a route as gated by a feature flag. Requires FeatureFlagGuard. */
export const FeatureFlag = (key: string) => SetMetadata(FEATURE_FLAG_KEY, key);
