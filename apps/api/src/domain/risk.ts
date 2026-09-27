/**
 * Risk severity.
 *
 * Severity is derived from probability and impact, never typed in by a user, so two risks
 * with the same inputs always carry the same severity and the register can be sorted and
 * filtered meaningfully (spec section 44).
 */
import type { RiskLevel } from '@ekavist/shared';

const SCORE: Record<RiskLevel, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  VERY_HIGH: 4,
};

/**
 * The 4x4 matrix. Read it as rows of probability (LOW..VERY_HIGH) by columns of impact.
 * A low-probability, catastrophic-impact risk still lands at HIGH — the point of a
 * register is that rare disasters are not filed away as minor.
 */
const MATRIX: Record<RiskLevel, Record<RiskLevel, RiskLevel>> = {
  LOW: { LOW: 'LOW', MEDIUM: 'LOW', HIGH: 'MEDIUM', VERY_HIGH: 'HIGH' },
  MEDIUM: { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', VERY_HIGH: 'HIGH' },
  HIGH: { LOW: 'MEDIUM', MEDIUM: 'HIGH', HIGH: 'HIGH', VERY_HIGH: 'VERY_HIGH' },
  VERY_HIGH: { LOW: 'MEDIUM', MEDIUM: 'HIGH', HIGH: 'VERY_HIGH', VERY_HIGH: 'VERY_HIGH' },
};

export function riskSeverity(probability: RiskLevel, impact: RiskLevel): RiskLevel {
  return MATRIX[probability][impact];
}

/** 1..16, used for ordering the register so equal severities still sort sensibly. */
export function riskSeverityScore(probability: RiskLevel, impact: RiskLevel): number {
  return SCORE[probability] * SCORE[impact];
}

export function riskLevelRank(level: RiskLevel): number {
  return SCORE[level];
}

/** Risks that still need attention, as opposed to those already dealt with. */
export function isOpenRisk(status: string): boolean {
  return status === 'OPEN' || status === 'MONITORING' || status === 'OCCURRED';
}

export function isOpenIssue(status: string): boolean {
  return status === 'OPEN' || status === 'INVESTIGATING' || status === 'IN_PROGRESS';
}
