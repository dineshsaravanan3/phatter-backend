import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  // Expose the extended client with global soft delete query filters
  public readonly client = this.$extends({
    query: {
      $allModels: {
        async findMany({ model, operation, args, query }) {
          if (['Message', 'Channel', 'Task'].includes(model)) {
            args.where = { ...args.where, deletedAt: null };
          }
          return query(args);
        },
        async findFirst({ model, operation, args, query }) {
          if (['Message', 'Channel', 'Task'].includes(model)) {
            args.where = { ...args.where, deletedAt: null };
          }
          return query(args);
        },
        async findUnique({ model, operation, args, query }) {
          if (['Message', 'Channel', 'Task'].includes(model)) {
            args.where = { ...args.where, deletedAt: null };
          }
          return query(args);
        },
        async count({ model, operation, args, query }) {
          if (['Message', 'Channel', 'Task'].includes(model)) {
            args.where = { ...args.where, deletedAt: null };
          }
          return query(args);
        },
      },
    },
  });

  constructor() {
    super({
      log: ['error', 'warn'],
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
