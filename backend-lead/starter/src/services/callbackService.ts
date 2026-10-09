import { sequelize } from '../db/sequelize';
import { Transaction } from 'sequelize';
import { Deposit, PspCallbackAudit, Wallet } from '../db/models';
import { CallbackAuditOutcome, ReportedCallbackStatus } from '../db/models/pspCallbackAudit';
import { dec, fitsMoney } from '../lib/money';
import { balanceAfterMovement, recordWalletMovement } from './walletMovement';

type CallbackEvent = { pspRef: string; status: ReportedCallbackStatus; amount: string };

async function recordCallbackAudit(
  event: CallbackEvent,
  depositId: string | null,
  outcome: CallbackAuditOutcome,
  transaction?: Transaction,
): Promise<void> {
  await PspCallbackAudit.create({
    providerId: 'mock',
    pspRef: event.pspRef,
    depositId,
    reportedStatus: event.status,
    reportedAmount: event.amount,
    outcome,
    reconciliationRequired: outcome === 'contradictory_terminal',
  }, { transaction });
}

export type CallbackResult =
  | { kind: 'settled'; status: 'Pending' | 'Completed' | 'Failed' }
  | { kind: 'not_found' | 'amount_mismatch' | 'conflicting_status' | 'balance_overflow' | 'wallet_frozen' };

export async function settleMockCallback(
  pspRef: string,
  status: 'pending' | 'completed' | 'failed',
  amount: string,
): Promise<CallbackResult> {
  const event = { pspRef, status, amount };
  // The first read locates the immutable owner only. Decisions use the locked copy below.
  const locator = await Deposit.findOne({ where: { providerId: 'mock', pspRef } });
  if (!locator) {
    await recordCallbackAudit(event, null, 'unknown_reference');
    return { kind: 'not_found' };
  }

  return sequelize.transaction(async (transaction) => {
    // Every wallet writer takes this lock first, including future wager and withdrawal paths.
    const wallet = await Wallet.findOne({
      where: { memberId: locator.memberId },
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!wallet) {
      throw new Error(`Deposit ${locator.id} has no wallet`);
    }
    const deposit = await Deposit.findByPk(locator.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!deposit || deposit.providerId !== 'mock' || deposit.pspRef !== pspRef || deposit.memberId !== wallet.memberId) {
      throw new Error(`Deposit ${locator.id} changed ownership`);
    }

    if (status === 'pending' && deposit.status !== 'Pending') {
      await recordCallbackAudit(event, deposit.id, 'stale_pending', transaction);
      return { kind: 'settled', status: deposit.status } as const;
    }
    const targetStatus = status === 'completed' ? 'Completed' : status === 'failed' ? 'Failed' : 'Pending';
    if (deposit.status !== 'Pending' && deposit.status !== targetStatus) {
      await recordCallbackAudit(event, deposit.id, 'contradictory_terminal', transaction);
      return { kind: 'conflicting_status' } as const;
    }
    if (status === 'completed' && !dec(deposit.amount).isEqualTo(dec(amount))) {
      await recordCallbackAudit(event, deposit.id, 'amount_mismatch', transaction);
      return { kind: 'amount_mismatch' } as const;
    }
    if (status === 'pending') {
      return { kind: 'settled', status: 'Pending' } as const;
    }
    if (deposit.status !== 'Pending') {
      return { kind: 'settled', status: targetStatus } as const;
    }

    if (targetStatus === 'Completed') {
      if (wallet.frozen) return { kind: 'wallet_frozen' } as const;
      const nextBalance = balanceAfterMovement(wallet, deposit.amount);
      if (!fitsMoney(nextBalance)) {
        return { kind: 'balance_overflow' } as const;
      }
      await recordWalletMovement(wallet, `deposit:${deposit.id}`, deposit.amount, transaction);
    }
    await deposit.update({ status: targetStatus }, { transaction });
    return { kind: 'settled', status: targetStatus } as const;
  });
}
