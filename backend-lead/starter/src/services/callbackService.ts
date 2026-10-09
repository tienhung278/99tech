import { sequelize } from '../db/sequelize';
import { Deposit, PspCallbackAudit, Wallet, WalletLedgerEntry } from '../db/models';
import { dec, fitsMoney } from '../lib/money';

export type CallbackResult =
  | { kind: 'settled'; status: 'Pending' | 'Completed' | 'Failed' }
  | { kind: 'not_found' | 'amount_mismatch' | 'conflicting_status' | 'balance_overflow' | 'wallet_frozen' };

export async function settleMockCallback(
  pspRef: string,
  status: 'pending' | 'completed' | 'failed',
  amount: string,
): Promise<CallbackResult> {
  // The first read locates the immutable owner only. Decisions use the locked copy below.
  const locator = await Deposit.findOne({ where: { providerId: 'mock', pspRef } });
  if (!locator) {
    await PspCallbackAudit.create({
      providerId: 'mock', pspRef, depositId: null,
      reportedStatus: status, reportedAmount: amount,
      outcome: 'unknown_reference', reconciliationRequired: false,
    });
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
    if (wallet.frozen) return { kind: 'wallet_frozen' } as const;
    const deposit = await Deposit.findByPk(locator.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (!deposit || deposit.providerId !== 'mock' || deposit.pspRef !== pspRef || deposit.memberId !== wallet.memberId) {
      throw new Error(`Deposit ${locator.id} changed ownership`);
    }

    if (status === 'pending' && deposit.status !== 'Pending') {
      await PspCallbackAudit.create({
        providerId: 'mock', pspRef, depositId: deposit.id,
        reportedStatus: status, reportedAmount: amount,
        outcome: 'stale_pending', reconciliationRequired: false,
      }, { transaction });
      return { kind: 'settled', status: deposit.status } as const;
    }
    const targetStatus = status === 'completed' ? 'Completed' : status === 'failed' ? 'Failed' : 'Pending';
    if (deposit.status !== 'Pending' && deposit.status !== targetStatus) {
      await PspCallbackAudit.create({
        providerId: 'mock', pspRef, depositId: deposit.id,
        reportedStatus: status, reportedAmount: amount,
        outcome: 'contradictory_terminal', reconciliationRequired: true,
      }, { transaction });
      return { kind: 'conflicting_status' } as const;
    }
    if (!dec(deposit.amount).isEqualTo(dec(amount))) {
      await PspCallbackAudit.create({
        providerId: 'mock', pspRef, depositId: deposit.id,
        reportedStatus: status, reportedAmount: amount,
        outcome: 'amount_mismatch', reconciliationRequired: false,
      }, { transaction });
      return { kind: 'amount_mismatch' } as const;
    }
    if (status === 'pending') {
      return { kind: 'settled', status: 'Pending' } as const;
    }
    if (deposit.status !== 'Pending') {
      return { kind: 'settled', status: targetStatus } as const;
    }

    if (targetStatus === 'Completed') {
      const nextBalance = dec(wallet.balance).plus(deposit.amount);
      if (!fitsMoney(nextBalance)) {
        return { kind: 'balance_overflow' } as const;
      }
      await WalletLedgerEntry.create({
        walletId: wallet.id,
        eventKey: `deposit:${deposit.id}`,
        amount: deposit.amount,
      }, { transaction });
      await wallet.update({ balance: nextBalance.toFixed(18) }, { transaction });
    }
    await deposit.update({ status: targetStatus }, { transaction });
    return { kind: 'settled', status: targetStatus } as const;
  });
}
