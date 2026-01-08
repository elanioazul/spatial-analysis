import { Controller, Get, ParseFloatPipe, ParseIntPipe, Query } from '@nestjs/common';
import { AppService } from './app.service';

@Controller('spatial')
export class AppController {
  constructor(private readonly appService: AppService) {}

/**
   * Endpoint for GDAL Variation
   * GET /spatial/viewshed-gdal?lat=...&lon=...&radius=...&height=...
   */
  @Get('viewshed-gdal')
  async getGdalViewshed(
    @Query('lat', ParseFloatPipe) lat: number,
    @Query('lon', ParseFloatPipe) lon: number,
    @Query('radius', ParseIntPipe) radius: number,
    @Query('height', ParseIntPipe) height: number,
  ) {
    const startTime = Date.now();
    const result = await this.appService.getViewshedGdal(lat, lon, radius, height);
    const duration = Date.now() - startTime;

    return {
      engine: 'GDAL+ Postgis',
      executionTimeMs: duration,
      geojson: result,
    };
  }
}
