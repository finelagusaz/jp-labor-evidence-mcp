import type { IndexSnapshotMeta } from './indexes/types.js';
import type { WarningMessage } from './types.js';

export type SearchRoute =
  | 'index_only'
  | 'upstream_fallback'
  | 'stale_but_usable'
  | 'coverage_below_threshold';

const MIN_COVERAGE_RATIO = 0.6;

export interface RoutingDecision {
  route: SearchRoute;
  allowUpstreamFallback: boolean;
  degraded: boolean;
  warnings: WarningMessage[];
}

export function decideSearchRouting(params: {
  indexHit: boolean;
  indexMeta?: IndexSnapshotMeta;
  forceRefresh?: boolean;
}): RoutingDecision {
  const warnings: WarningMessage[] = [];

  if (params.forceRefresh) {
    warnings.push({
      code: 'FORCE_REFRESH_NOT_IMPLEMENTED',
      message: 'force_refresh は未実装のため、通常の routing policy を適用しました。',
    });
  }

  if (params.indexHit) {
    if (params.indexMeta?.freshness === 'stale') {
      warnings.push({
        code: 'STALE_INDEX_USED',
        message: '内部 index は stale ですが、既知候補のため index-only で返しました。',
      });
      return {
        route: 'stale_but_usable',
        allowUpstreamFallback: false,
        degraded: true,
        warnings,
      };
    }

    return {
      route: 'index_only',
      allowUpstreamFallback: false,
      degraded: false,
      warnings,
    };
  }

  if (typeof params.indexMeta?.coverage_ratio === 'number' && params.indexMeta.coverage_ratio < MIN_COVERAGE_RATIO) {
    warnings.push({
      code: 'INDEX_COVERAGE_LOW',
      message: `内部 index の coverage_ratio=${params.indexMeta.coverage_ratio} のため、upstream fallback を抑止しました。`,
    });
    return {
      route: 'coverage_below_threshold',
      allowUpstreamFallback: false,
      degraded: true,
      warnings,
    };
  }

  return {
    route: 'upstream_fallback',
    allowUpstreamFallback: true,
    degraded: false,
    warnings,
  };
}
