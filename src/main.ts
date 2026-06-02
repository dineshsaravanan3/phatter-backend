import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Enable CORS
  const localhostOrigins = ['http://localhost:3000', 'http://localhost:4000', 'http://127.0.0.1:3000'];
  const productionOrigins = ['https://phatter.vercel.app', 'https://phatter.vercel.app/'];
  const envOrigins = process.env.FRONTEND_URL ? process.env.FRONTEND_URL.split(',').map(o => o.trim()) : [];
  const allowedOrigins = [...new Set([...localhostOrigins, ...productionOrigins, ...envOrigins])];

  app.enableCors({
    origin: (requestOrigin, callback) => {
      // Normalize origin by removing trailing slash for consistent comparison
      const normalizedOrigin = requestOrigin ? requestOrigin.replace(/\/$/, '') : '';
      const isAllowed = !requestOrigin || allowedOrigins.some(o => o.replace(/\/$/, '') === normalizedOrigin);
      
      if (isAllowed) {
        callback(null, true);
      } else {
        console.warn(`CORS blocked origin: ${requestOrigin}`);
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  });

  // Cookie Parser
  app.use(cookieParser());

  // Global Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
    }),
  );

  // Swagger Documentation Setup
  const config = new DocumentBuilder()
    .setTitle('CollabHQ Authentication API')
    .setDescription('Production-ready multi-client JWT and session authentication API documentation.')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ?? 4000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
  console.log(`Swagger documentation is available at: http://localhost:${port}/api/docs`);
  console.log(`CORS allowed origins: ${allowedOrigins.join(', ')}`);
}
bootstrap();
