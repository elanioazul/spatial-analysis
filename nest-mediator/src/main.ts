import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
    app.useGlobalPipes(
    new ValidationPipe({
      //whitelist: true,
      //forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
  app.enableCors();
  await app.listen(process.env.NEST_PORT ?? 3000);
  //docker ps --format "table {{.Names}}\t{{.Ports}}"
  //docker exec spatial_nestjs netstat -an | grep LISTEN
  console.log(`
    Server is listening on: http://0.0.0.0:${process.env.NEST_PORT}, 
    but check in compose file for mapped port in host machine`
  );
}
bootstrap();
