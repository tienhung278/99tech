'use strict';

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable('deposits', {
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
      turnover_multiplier: { type: Sequelize.DECIMAL(36, 0), allowNull: false, defaultValue: '1' },
      provider_id: { type: Sequelize.STRING(64), allowNull: false },
      psp_ref: { type: Sequelize.STRING(128), allowNull: false, unique: true },
      status: { type: Sequelize.STRING(16), allowNull: false, defaultValue: 'Pending' },
      created_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
      updated_at: { type: Sequelize.DATE, allowNull: false, defaultValue: Sequelize.literal('now()') },
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE deposits
      ADD CONSTRAINT deposits_amount_positive CHECK (amount > 0),
      ADD CONSTRAINT deposits_multiplier_nonnegative CHECK (turnover_multiplier >= 0),
      ADD CONSTRAINT deposits_status_valid CHECK (status IN ('Pending', 'Completed', 'Failed'))
    `);
  },

  async down(queryInterface) {
    await queryInterface.dropTable('deposits');
  },
};
