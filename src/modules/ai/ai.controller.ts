import { Controller, Post, Body, Get, Req, UseGuards, Delete } from '@nestjs/common';
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

  @Get('messages')
  getMessages(@Req() req: any) {
    return this.aiService.getChatMessages(req.user?.id);
  }

  @Delete('messages')
  clearMessages(@Req() req: any) {
    return this.aiService.clearChatHistory(req.user?.id);
  }

  @Post('chat')
  chat(@Body() body: { index: number; reply: string; timezone?: string }, @Req() req: any) {
    return this.aiService.handleUserReply(body.index, body.reply, req.user?.id, body.timezone);
  }

  @Post('execute')
  execute(@Body() body: { actionId: string }, @Req() req: any) {
    return this.aiService.executeConfirmedTool(req.user?.id, body.actionId);
  }

  @Post('cancel')
  cancel(@Body() body: { actionId: string }, @Req() req: any) {
    return this.aiService.cancelAction(req.user?.id, body.actionId);
  }
}
