'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('withdrawals', {
      id: {
        type: Sequelize.UUID,
        primaryKey: true,
        defaultValue: Sequelize.literal('gen_random_uuid()'),
      },
      member_id: {
        type: Sequelize.UUID,
        allowNull: false,
        references: { model: 'members', key: 'id' },
      },
      amount: { type: Sequelize.DECIMAL(36, 18), allowNull: false },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'Pending' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE withdrawals
      ADD CONSTRAINT withdrawals_amount_positive CHECK (amount > 0),
      ADD CONSTRAINT withdrawals_status_valid CHECK (status = 'Pending')
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('withdrawals');
  },
};
