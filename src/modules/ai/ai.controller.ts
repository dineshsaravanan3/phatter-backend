import { Controller, Post, Body, Get } from '@nestjs/common';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('initial')
  getInitial() {
    return this.aiService.getInitialQuestion();
  }

  @Post('chat')
  chat(@Body() body: { index: number; reply: string }) {
    return this.aiService.handleUserReply(body.index, body.reply);
  }
}
