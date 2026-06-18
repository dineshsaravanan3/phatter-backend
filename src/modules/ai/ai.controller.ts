import { Controller, Post, Body, Get, Req, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) {}

  @Get('initial')
  getInitial() {
    return this.aiService.getInitialQuestion();
  }

  @Post('chat')
  chat(@Body() body: { index: number; reply: string }, @Req() req: any) {
    return this.aiService.handleUserReply(body.index, body.reply, req.user?.id);
  }
}
