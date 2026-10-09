import { randomUUID } from 'crypto';
import { Deposit, Member } from '../db/models';

export async function createDeposit(
  memberId: string,
  amount: string,
  turnoverMultiplier: number,
): Promise<Deposit | null> {
  if (!(await Member.findByPk(memberId))) {
    return null;
  }

  return Deposit.create({
    memberId,
    amount,
    turnoverMultiplier: String(turnoverMultiplier),
    providerId: 'mock',
    pspRef: randomUUID(),
    status: 'Pending',
  });
}
