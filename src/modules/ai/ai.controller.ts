import {
  Controller,
  Post,
  Body,
  Get,
  Req,
  UseGuards,
  Delete,
  UploadedFile,
  UseInterceptors,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { ApiConsumes, ApiBody, ApiTags } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../auth/jwt.guard';

@ApiTags('AI')
@UseGuards(JwtAuthGuard)
@Controller('ai')
export class AiController {
  constructor(private readonly aiService: AiService) { }

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

  // ── Voice to Text ────────────────────────────────────────────────────────
  @Post('transcribe')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        audio: { type: 'string', format: 'binary' },
      },
    },
  })
  @UseInterceptors(
    FileInterceptor('audio', {
      storage: memoryStorage(),
      limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
      fileFilter: (req, file, cb) => {
        // Accept audio files and webm/mp4 video containers containing audio
        if (
          file.mimetype.startsWith('audio/') ||
          file.mimetype.startsWith('video/') ||
          file.mimetype === 'application/octet-stream'
        ) {
          cb(null, true);
        } else {
          cb(
            new HttpException(
              'Only audio files are allowed',
              HttpStatus.BAD_REQUEST,
            ),
            false,
          );
        }
      },
    }),
  )
  async transcribe(@UploadedFile() file: any, @Req() req: any) {
    if (!file) {
      throw new HttpException('No audio file provided', HttpStatus.BAD_REQUEST);
    }
    return this.aiService.transcribeAudio(file, req.user?.id);
  }
}
