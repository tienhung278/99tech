import { sequelize } from '../sequelize';
import { Member, initMember } from './member';
import { Wallet, initWallet } from './wallet';
import { Deposit, initDeposit } from './deposit';

initMember(sequelize);
initWallet(sequelize);
initDeposit(sequelize);

Member.hasOne(Wallet, { foreignKey: 'memberId', as: 'wallet' });
Wallet.belongsTo(Member, { foreignKey: 'memberId', as: 'member' });
Member.hasMany(Deposit, { foreignKey: 'memberId', as: 'deposits' });
Deposit.belongsTo(Member, { foreignKey: 'memberId', as: 'member' });

export { Member, Wallet, Deposit };
