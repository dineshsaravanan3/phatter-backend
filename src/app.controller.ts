import { Controller, Get, Param, Res } from '@nestjs/common';
import * as express from 'express';
import { join } from 'path';
import { existsSync } from 'fs';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('chat/voice-notes/:filename')
  serveVoiceNote(@Param('filename') filename: string, @Res() res: express.Response) {
    const filePath = join(process.cwd(), 'uploads', 'voice-notes', filename);
    if (!existsSync(filePath)) {
      return res.status(404).send('File not found');
    }
    return res.sendFile(filePath);
  }
}
