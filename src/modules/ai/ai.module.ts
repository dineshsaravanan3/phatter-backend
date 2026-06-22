import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { ToolRegistryService } from './tool-registry.service';
import { PrismaModule } from '../../prisma/prisma.module';
import { ChatModule } from '../chat/chat.module';

@Module({
  imports: [PrismaModule, ChatModule],
  controllers: [AiController],
  providers: [AiService, ToolRegistryService],
  exports: [AiService, ToolRegistryService],
})
export class AiModule {}
