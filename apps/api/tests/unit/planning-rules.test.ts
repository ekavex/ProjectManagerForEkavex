import { describe, expect, it } from 'vitest';
import {
  earnedValue,
  plannedFraction,
  type EarnedValueTask,
} from '../../src/domain/earned-value.js';
import {
  dependencyConflicts,
  isDependencyViolated,
  unmetCompletionCriteria,
} from '../../src/domain/task-rules.js';
import { mondayOf, workingDates } from '../../src/domain/working-days.js';
import { csvCell, toCsv } from '../../src/lib/csv.js';
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  hotp,
  totp,
  verifyTotp,
} from '../../src/lib/totp.js';

const task = (overrides: Partial<EarnedValueTask>): EarnedValueTask => ({
  status: 'NOT_STARTED',
  progress: 0,
  estimatedHours: 10,
  actualHours: null,
  startDate: '2026-09-01',
  dueDate: '2026-09-10',
  ...overrides,
});

describe('earned value', () => {
  it('plans nothing before a task starts and everything once it is due', () => {
    expect(plannedFraction(task({}), '2026-08-31')).toBe(0);
    expect(plannedFraction(task({}), '2026-09-10')).toBe(1);
    expect(plannedFraction(task({}), '2026-09-05')).toBeCloseTo(0.5);
  });

  it('treats a task with only a due date as planned to finish on that date', () => {
    expect(plannedFraction(task({ startDate: null }), '2026-09-09')).toBe(0);
    expect(plannedFraction(task({ startDate: null }), '2026-09-10')).toBe(1);
  });

  it('computes SPI and CPI from estimates, progress and actual hours', () => {
    const metrics = earnedValue(
      [
        task({ status: 'COMPLETED', progress: 100, actualHours: 12, dueDate: '2026-09-05' }),
        task({ status: 'IN_PROGRESS', progress: 50, actualHours: 8 }),
      ],
      '2026-09-10',
    );
    expect(metrics.budgetAtCompletion).toBe(20);
    expect(metrics.plannedValue).toBe(20);
    expect(metrics.earnedValue).toBe(15);
    expect(metrics.actualCost).toBe(20);
    expect(metrics.spi).toBe(0.75);
    expect(metrics.cpi).toBe(0.75);
    expect(metrics.estimateAtCompletion).toBeCloseTo(26.7, 1);
  });

  it('leaves the ratios null rather than dividing by zero', () => {
    const metrics = earnedValue([task({})], '2026-08-01');
    expect(metrics.spi).toBeNull();
    expect(metrics.cpi).toBeNull();
  });

  it('counts open tasks without an estimate and keeps cancelled work out of the plan', () => {
    const metrics = earnedValue(
      [
        task({ estimatedHours: null }),
        task({ status: 'CANCELLED', actualHours: 3 }),
        task({ status: 'COMPLETED', estimatedHours: null }),
      ],
      '2026-09-10',
    );
    expect(metrics.tasksWithoutEstimate).toBe(1);
    expect(metrics.budgetAtCompletion).toBe(0);
    expect(metrics.actualCost).toBe(3);
  });
});

describe('dependency rules for all four types', () => {
  const pred = (status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED') => ({
    status,
  });

  it('Finish-to-Start warns on starting before the predecessor finishes', () => {
    const links = [{ type: 'FINISH_TO_START' as const, predecessor: pred('IN_PROGRESS') }];
    expect(dependencyConflicts('NOT_STARTED', 'IN_PROGRESS', links)).toHaveLength(1);
    expect(dependencyConflicts('IN_PROGRESS', 'BLOCKED', links)).toHaveLength(0);
  });

  it('Start-to-Start warns on starting before the predecessor starts', () => {
    expect(
      dependencyConflicts('NOT_STARTED', 'IN_PROGRESS', [
        { type: 'START_TO_START', predecessor: pred('NOT_STARTED') },
      ])[0]?.reason,
    ).toBe('has not started yet');
    expect(
      dependencyConflicts('NOT_STARTED', 'IN_PROGRESS', [
        { type: 'START_TO_START', predecessor: pred('IN_PROGRESS') },
      ]),
    ).toHaveLength(0);
  });

  it('Finish-to-Finish warns on completing before the predecessor finishes', () => {
    const links = [{ type: 'FINISH_TO_FINISH' as const, predecessor: pred('IN_PROGRESS') }];
    expect(dependencyConflicts('NOT_STARTED', 'IN_PROGRESS', links)).toHaveLength(0);
    expect(dependencyConflicts('IN_PROGRESS', 'COMPLETED', links)).toHaveLength(1);
  });

  it('Start-to-Finish warns on completing before the predecessor starts', () => {
    const links = [{ type: 'START_TO_FINISH' as const, predecessor: pred('NOT_STARTED') }];
    expect(dependencyConflicts('IN_PROGRESS', 'COMPLETED', links)).toHaveLength(1);
    expect(
      dependencyConflicts('IN_PROGRESS', 'COMPLETED', [
        { type: 'START_TO_FINISH', predecessor: pred('IN_PROGRESS') },
      ]),
    ).toHaveLength(0);
  });

  it('never lets a cancelled predecessor block anything', () => {
    for (const type of [
      'FINISH_TO_START',
      'START_TO_START',
      'FINISH_TO_FINISH',
      'START_TO_FINISH',
    ] as const) {
      expect(
        dependencyConflicts('NOT_STARTED', 'COMPLETED', [{ type, predecessor: pred('CANCELLED') }]),
      ).toHaveLength(0);
      expect(isDependencyViolated(type, 'CANCELLED', 'COMPLETED')).toBe(false);
    }
  });

  it('judges existing states the same way for the health indicator', () => {
    expect(isDependencyViolated('FINISH_TO_START', 'IN_PROGRESS', 'IN_PROGRESS')).toBe(true);
    expect(isDependencyViolated('START_TO_START', 'IN_PROGRESS', 'IN_PROGRESS')).toBe(false);
    expect(isDependencyViolated('FINISH_TO_FINISH', 'IN_PROGRESS', 'IN_PROGRESS')).toBe(false);
    expect(isDependencyViolated('FINISH_TO_FINISH', 'IN_PROGRESS', 'COMPLETED')).toBe(true);
    expect(isDependencyViolated('START_TO_FINISH', 'NOT_STARTED', 'COMPLETED')).toBe(true);
  });
});

describe('completion criteria', () => {
  const none = { requiresNote: false, requiresActualHours: false, requiresAttachment: false };
  const all = { requiresNote: true, requiresActualHours: true, requiresAttachment: true };

  it('asks for nothing when the project defines no criteria', () => {
    expect(
      unmetCompletionCriteria(none, { note: null, actualHours: null, attachments: 0 }),
    ).toEqual([]);
  });

  it('lists every missing piece of evidence', () => {
    expect(
      unmetCompletionCriteria(all, { note: '  ', actualHours: 0, attachments: 0 }),
    ).toHaveLength(3);
    expect(unmetCompletionCriteria(all, { note: 'Done', actualHours: 2, attachments: 1 })).toEqual(
      [],
    );
  });
});

describe('working days', () => {
  it('skips weekends and holidays', () => {
    // 2030-03-04 is a Monday.
    expect(workingDates('2030-03-04', '2030-03-10', new Set())).toHaveLength(5);
    expect(workingDates('2030-03-04', '2030-03-10', new Set(['2030-03-05']))).toHaveLength(4);
    expect(workingDates('2030-03-09', '2030-03-10', new Set())).toHaveLength(0);
  });

  it('finds the Monday of a week, including from a Sunday', () => {
    expect(mondayOf('2030-03-06')).toBe('2030-03-04');
    expect(mondayOf('2030-03-10')).toBe('2030-03-04');
    expect(mondayOf('2030-03-04')).toBe('2030-03-04');
  });
});

describe('TOTP', () => {
  // RFC 6238 appendix B test secret ("12345678901234567890"), SHA-1, eight digits there;
  // the six-digit codes are the last six of the published values.
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('round-trips base32', () => {
    expect(base32Decode(secret).toString()).toBe('12345678901234567890');
  });

  it('matches the RFC test vectors', () => {
    expect(totp(secret, new Date(59 * 1000))).toBe('287082');
    expect(totp(secret, new Date(1111111109 * 1000))).toBe('081804');
    expect(totp(secret, new Date(1234567890 * 1000))).toBe('005924');
    expect(hotp(secret, 0)).toBe('755224');
  });

  it('accepts one step of drift either way and nothing beyond', () => {
    const at = new Date(1234567890 * 1000);
    const code = totp(secret, at);
    expect(verifyTotp(secret, code, new Date(at.getTime() + 30_000))).toBe(true);
    expect(verifyTotp(secret, code, new Date(at.getTime() - 30_000))).toBe(true);
    expect(verifyTotp(secret, code, new Date(at.getTime() + 90_000))).toBe(false);
    expect(verifyTotp(secret, 'abcdef', at)).toBe(false);
  });

  it('produces distinct recovery codes', () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[0-9a-f]{5}-[0-9a-f]{5}$/);
  });
});

describe('CSV export', () => {
  it('quotes separators, quotes and line breaks', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(42)).toBe('42');
  });

  it('defuses values a spreadsheet would run as formulas', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    // Numbers are numbers, not formulas.
    expect(csvCell(-5)).toBe('-5');
  });

  it('writes a header row, a byte-order mark and CRLF line ends', () => {
    const csv = toCsv([{ name: 'A' }], [{ header: 'Name', value: (row) => row.name }]);
    expect(csv).toBe('﻿Name\r\nA\r\n');
  });
});
