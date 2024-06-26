"use strict";

const TABLE_NAME = "calls";
const db = require("../db/init.mysql");

module.exports = (sequelize, { DataTypes }) => {
  const call = sequelize.define(
    "Call",
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false,
      },
      conservation: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
          model: "conservation",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      startedAt: {
        type: DataTypes.DATE,
        defaultValue: new Date(),
      },
      endedAt: {
        type: DataTypes.DATE,
      },
      caller: {
        type: DataTypes.UUID,
        references: {
          model: "user",
          key: "id",
        },
      },
    },
    {
      tableName: TABLE_NAME,
      hooks: {
        afterCreate: async function (record) {
          const conservation = record.conservation;
          if (!conservation) return;

          const foundConservation = await db.Conservation.findOne({
            where: {
              id: conservation,
            },
          });

          await foundConservation.increment("call_count");
        },
        afterDestroy: async function (record) {
          const conservation = record.conservation;
          if (!conservation) return;

          const foundConservation = await db.Conservation.findOne({
            where: {
              id: conservation,
            },
          });

          await foundConservation.decrement("call_count");
        },
      },
    }
  );

  return call;
};
