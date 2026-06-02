import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RefreshDto {
  @ApiProperty({ example: 'uuid-token-string', description: 'The refresh token (only for mobile/Electron clients)', required: false })
  @IsOptional()
  @IsString()
  refreshToken?: string;

  @ApiProperty({ example: 'iphone-14-pro-device-id', description: 'Device/client identifier', required: false })
  @IsOptional()
  @IsString()
  deviceId?: string;
}
