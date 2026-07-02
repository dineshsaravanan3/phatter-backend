import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ToolRegistryService } from './tool-registry.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [
    PrismaModule,
    ChatModule,
    MulterModule.register({
      limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
    }),
  ],
  controllers: [AiController],
  providers: [AiService, ToolRegistryService],
  exports: [AiService, ToolRegistryService],
})
export class AiModule {}
