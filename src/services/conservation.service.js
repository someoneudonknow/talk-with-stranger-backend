"use strict";

const { where, QueryTypes } = require("sequelize");
const {
  BadRequestError,
  NotFoundError,
  InternalServerError,
  ForbiddenError,
  ConflictError,
} = require("../core/error.response");
const db = require("../db/init.mysql");

class ConservationService {
  static createConservation = async ({ userId, body }) => {
    const memberIds = body.members;
    const memberIdsSet = new Set(memberIds);

    memberIdsSet.add(userId);

    const pendingCheck = Array.from(memberIdsSet).map(async (mid) => {
      const foundAnother = await db.User.findOne({
        where: {
          id: mid,
        },
      });

      return foundAnother.toJSON();
    });

    const membersValid = await Promise.all(pendingCheck);

    if (!membersValid.every((con) => !!con)) {
      throw new BadRequestError("Invalid members");
    }

    const insertedConservation = await db.Conservation.create({
      creator: userId,
      type: body.type,
    });

    const insertDataSet = membersValid.map((m) => ({
      user_id: m.id,
      conservation: insertedConservation.id,
    }));

    await db.Member.bulkCreate(insertDataSet);

    return insertedConservation;
  };

  static joinConservation = async ({ conservationId, userId }) => {
    const foundConservation = await db.Conservation.findOne({
      where: {
        is_deleted: false,
        id: conservationId,
      },
    });
    if (!foundConservation) throw new BadRequestError("Conservation not found");

    const member = await db.Member.findOne({
      where: {
        conservation: conservationId,
        user_id: userId,
      },
    });

    if (member) throw new ConflictError("You already join this conservation");

    if (foundConservation.type === "one_to_one")
      throw new BadRequestError("Can not join a private conservation");

    await db.Member.create({
      user_id: userId,
      conservation: foundConservation.id,
    });

    return foundConservation;
  };

  static leaveConservation = async ({ conservationId, userId }) => {
    const foundConservation = await db.Conservation.findOne({
      where: {
        id: conservationId,
      },
    });

    if (!foundConservation) throw new BadRequestError("Conservation not found");

    const member = await db.Member.findOne({
      where: {
        conservation: conservationId,
        user_id: userId,
      },
    });

    if (!member) throw new ConflictError("You are not a member");

    if (foundConservation.type === "one_to_one")
      throw new BadRequestError("Can not leave conservation");
    if (foundConservation.creator === userId)
      throw new ForbiddenError("Creator can not leave conservation");

    const memberCount = await db.Member.count({
      where: {
        conservation: foundConservation.id,
      },
    });

    await db.Member.destroy({
      where: {
        user_id: userId,
      },
    });

    if (memberCount == 1) {
      foundConservation.is_deleted = true;
    }
    await foundConservation.save();

    return foundConservation;
  };

  static getConservation = async ({ conservationId }) => {
    const foundConservation = await db.Conservation.findOne({
      where: {
        id: conservationId,
      },
    });

    const members = await db.sequelize.query(
      "SELECT u.id, u.user_description, u.user_first_name, u.user_last_name, u.user_email, u.user_avatar, u.user_gender, u.user_dob FROM conservation c JOIN member m ON c.id = m.conservation JOIN user u ON m.user_id = u.id WHERE c.id = :conservationId",
      {
        type: QueryTypes.SELECT,
        replacements: {
          conservationId: foundConservation.id,
        },
      }
    );

    const lastestMessage = await db.Message.findOne({
      where: {
        conservation: foundConservation.id,
      },
      order: [["created_at", "DESC"]],
    });

    return {
      ...foundConservation.toJSON(),
      members,
      lastestMessage,
    };
  };

  static deleteConservation = async ({ conservationId, userId }) => {
    const foundConservation = await db.Conservation.findOne({
      where: {
        id: conservationId,
      },
    });

    if (!foundConservation) throw new BadRequestError("Conservation not found");
    if (foundConservation.type === "one_to_one")
      throw new BadRequestError("Can not delete conservation");
    if (foundConservation.creator !== userId)
      throw new ForbiddenError("You are not creator");

    foundConservation.is_deleted = true;
    await db.Conservation.save();

    return null;
  };

  static getConservations = async ({ userId, query }) => {
    const pageNum = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;

    const memberConservation = await db.sequelize.query(
      "SELECT * FROM conservation c JOIN member m ON c.id = m.conservation WHERE m.user_id = :userId AND is_deleted = :isDeleted LIMIT :limit OFFSET :offset",
      {
        type: QueryTypes.SELECT,
        replacements: {
          userId: userId,
          isDeleted: false,
          limit,
          offset: (pageNum - 1) * limit,
        },
      }
    );

    const conservationCount = await db.sequelize.query(
      "SELECT COUNT(c.id) as conservationCnt FROM conservation c JOIN member m ON c.id = m.conservation WHERE m.user_id = :userId AND is_deleted = :isDeleted",
      {
        type: QueryTypes.SELECT,
        replacements: {
          userId: userId,
          isDeleted: false,
        },
      }
    );

    const conservations = memberConservation.map((mc) => {
      return {
        id: mc.conservation,
        type: mc.type,
        callCount: mc.call_count,
        messageCount: mc.message_count,
        creatorId: mc.creator,
      };
    });

    const conservationMembers = await Promise.all(
      conservations.map(async (c) => {
        const members = await db.sequelize.query(
          "SELECT u.id, u.user_description, u.user_first_name, u.user_last_name, u.user_email, u.user_avatar, u.user_gender, u.user_dob FROM conservation c JOIN member m ON c.id = m.conservation JOIN user u ON m.user_id = u.id WHERE c.id = :conservationId",
          {
            type: QueryTypes.SELECT,
            replacements: {
              conservationId: c.id,
            },
          }
        );

        const lastestMessage = await db.Message.findOne({
          where: {
            conservation: c.id,
          },
          order: [["created_at", "DESC"]],
        });

        return {
          ...c,
          lastestMessage,
          members: members,
        };
      })
    );

    return {
      data: conservationMembers.sort(
        (a, b) => b.lastestMessage?.created_at - a.lastestMessage?.created_at
      ),
      totalPage: Math.ceil(conservationCount.conservationCnt || 0 / limit),
    };
  };

  static search = async ({ userId, query }) => {
    const pageNum = parseInt(query.page) || 1;
    const limit = parseInt(query.limit) || 10;
    const text = query.text || "";
    console.log(text);
    const foundConservations = await db.sequelize.query(
      `
      SELECT u.user_first_name, u.user_last_name, u.user_avatar, c.id as conservation_id 
      FROM user u JOIN member m on m.user_id = u.id 
      JOIN conservation c ON c.id = m.conservation 
      WHERE c.id in (SELECT c.id FROM conservation c 
                    JOIN member m on c.id = m.conservation 
                    WHERE m.user_id = :userId and c.type = :type)
      AND u.id != :userId
       AND MATCH (u.user_first_name, u.user_last_name) AGAINST( :text IN BOOLEAN MODE) 
       ORDER BY MATCH (u.user_first_name, u.user_last_name) AGAINST( :text IN BOOLEAN MODE) DESC LIMIT :limit OFFSET :offset
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          userId,
          text: `${text}*`,
          type: `one_to_one`,
          limit,
          offset: (pageNum - 1) * limit,
        },
      }
    );

    return {
      data: foundConservations,
    };
  };
}

module.exports = ConservationService;
