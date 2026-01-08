import { Injectable, Inject, InternalServerErrorException, Logger } from '@nestjs/common';
import { Client } from 'pg';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';

const execPromise = promisify(exec);

@Injectable()
export class AppService {
  private readonly logger = new Logger(AppService.name);
  // Inside the Nest container, this is where we write files
  private readonly SHARED_DIR = '/tmp/spatial';
  // Inside the GDAL/GRASS containers, this is where they look
  private readonly CONTAINER_DATA_DIR = '/data';

  constructor(@Inject('PG_CLIENT') private readonly client: Client) { }

  /**
   * VARIATION 1: GDAL VIEWSHED
   */
  async getViewshedGdal(lat: number, lon: number, radius: number, obsHeight: number) {
    const id = Math.random().toString(36).substring(7);
    const mdtFile = `mdt_${id}.tif`;
    const outFile = `view_${id}.tif`;
    const jsonFile = `poly_${id}.json`;

    try {
      // 1. Export from PostGIS
      await this.exportRasterFromPostgis(lon, lat, radius, path.join(this.SHARED_DIR, mdtFile));

      // 2. Run GDAL via Docker Exec
      // Note: We use the Linux paths used INSIDE the gdal_cli container
      const gdalCmd = `docker exec spatial_gdal_cli gdal_viewshed -ox ${lon} -oy ${lat} -oz ${obsHeight} -md ${radius} "${this.CONTAINER_DATA_DIR}/${mdtFile}" "${this.CONTAINER_DATA_DIR}/${outFile}"`;
      await execPromise(gdalCmd);

      //lo siguiente lanzaría la efecución docker pero bajo un método de escucha de posibles fallos docker
      // const gdalResult = await this.runDockerCommand('spatial_gdal_cli', 
      //   `gdal_viewshed -ox ${lon} -oy ${lat} -oz ${obsHeight} -md ${radius} "${this.CONTAINER_DATA_DIR}/${mdtFile}" "${this.CONTAINER_DATA_DIR}/${outFile}"`
      // );
      // this.logger.log(`GDAL Output: ${gdalResult}`);

      // 3. Polygonize via Docker Exec
      const polyCmd = `docker exec spatial_gdal_cli gdal_polygonize.py "${this.CONTAINER_DATA_DIR}/${outFile}" -f "GeoJSON" "${this.CONTAINER_DATA_DIR}/${jsonFile}"`;
      await execPromise(polyCmd);

      return await this.processFinalIntersection(id, lon, lat, radius);
    } finally {
      //this.cleanup(id);
      console.log('cleaning up seria');
      
    }
  }

  // /**
  //  * VARIATION 2: GRASS GIS VIEWSHED
  //  */
  // async getViewshedGrass(lat: number, lon: number, radius: number, obsHeight: number) {
  //   const id = Math.random().toString(36).substring(7);
  //   const mdtFile = `mdt_${id}.tif`;
  //   const outFile = `view_${id}.tif`;

  //   try {
  //     await this.exportRasterFromPostgis(lon, lat, radius, path.join(this.SHARED_DIR, mdtFile));

  //     // GRASS requires a location/mapset. We run this as a single "one-shot" shell command inside the container
  //     const grassCmd = `docker exec grass_gis grass -c "${this.CONTAINER_DATA_DIR}/${mdtFile}" "${this.CONTAINER_DATA_DIR}/grass_db_${id}" --exec sh -c "
  //       r.in.gdal input=${this.CONTAINER_DATA_DIR}/${mdtFile} output=dem --o;
  //       g.region raster=dem;
  //       r.viewshed input=dem output=viewshed coordinates=${lon},${lat} observer_elevation=${obsHeight} max_distance=${radius} --o;
  //       r.to.vect input=viewshed output=viewshed_vec type=area;
  //       v.out.ogr input=viewshed_vec output=${this.CONTAINER_DATA_DIR}/poly_${id}.json format=GeoJSON;
  //     "`;

  //     await execPromise(grassCmd);

  //     return await this.processFinalIntersection(id, lon, lat, radius);
  //   } finally {
  //     this.cleanup(id);
  //   }
  // }

  private async exportRasterFromPostgis(lon: number, lat: number, radius: number, fullPath: string) {
    const sql = `SELECT ST_AsGDALRaster(ST_Union(rast), 'GTiff') as tiff FROM escorial_mdt02 
                 WHERE ST_Intersects(rast, ST_Buffer(ST_SetSRID(ST_Point($1, $2), 4326)::geography, $3 + 10)::geometry)`;
    const res = await this.client.query(sql, [lon, lat, radius]);
    if (!res.rows[0]?.tiff) throw new Error('MDT Data not found');
    fs.writeFileSync(fullPath, res.rows[0].tiff);
  }

  private async processFinalIntersection(id: string, lon: number, lat: number, radius: number) {
    const jsonPath = path.join(this.SHARED_DIR, `poly_${id}.json`);
    const geojsonRaw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    this.logger.debug(`GeoJSON Features count: ${geojsonRaw.features.length}`);
    const visibleFeature = geojsonRaw.features.find((f: any) => f.properties.DN > 0 || f.properties.value > 0);
    const visibleFeatures = geojsonRaw.features.filter((f: any) => f.properties.DN > 0 || f.properties.value > 0);
    const visibleGeometries = visibleFeatures.map(f => f.geometry);
    this.logger.debug(`Visible Feature: ${JSON.stringify(visibleFeature, null, 2)}`);

    if (!visibleFeature || !visibleFeature.geometry) {
      throw new InternalServerErrorException('No visible area found in viewshed');
    }

    // const intersectSql = `
    //     WITH 
    //     terrain_geom AS (
    //       SELECT ST_SetSRID(ST_GeomFromGeoJSON($1), 4326) as geom
    //     ),
    //     center_point AS (
    //         SELECT
    //             ST_SetSRID(ST_Point($2, $3), 4326) AS geom
    //     ),
    //     building_array AS (
    //       SELECT 
    //         COALESCE(array_agg(t.geom), ARRAY[]::geometry[]) AS polys
    //       FROM 
    //         escorial_buildings t, center_point c
    //       WHERE 
    //         ST_DWithin(t.geom::geography, c.geom::geography, $4::float8)
    //     )
    //     SELECT ST_AsGeoJSON(
    //       ST_Intersection(
    //         tg.geom, 
    //         VIEWSHED(
    //           cp.geom, 
    //           ba.polys, 
    //           $4::float8, -- Cast to double precision
    //           36,
    //           -999,
    //           360
    //         )
    //       )
    //     ) as final_result
    //     FROM terrain_geom tg, building_array ba, center_point cp;`;

    const intersectSql = `
        WITH 
        raw_geoms AS (
          -- Unnest the array of GeoJSON strings and convert to PostGIS geoms
          SELECT ST_SetSRID(ST_GeomFromGeoJSON(elem), 4326) as g
          FROM unnest($1::text[]) as elem
        ),
        terrain_geom AS (
          -- Union all visible islands into one MultiPolygon
          SELECT ST_Union(g) as geom FROM raw_geoms
        ),
        center_point AS (
          SELECT ST_SetSRID(ST_Point($2, $3), 4326) AS geom
        ),
        building_array AS (
          SELECT 
            COALESCE(array_agg(t.geom), ARRAY[]::geometry[]) AS polys 
          FROM 
            escorial_buildings t, center_point c
          WHERE 
            ST_DWithin(t.geom::geography, c.geom::geography, $4::float8)
        )
        SELECT ST_AsGeoJSON(
          ST_Intersection(
            tg.geom, 
            VIEWSHED(
              cp.geom, 
              ba.polys, 
              $4::float8, 
              36,
              -999,
              360
            )
          )
        ) as final_result
        FROM terrain_geom tg, building_array ba, center_point cp;`;

    const finalRes = await this.client.query(intersectSql, [
      visibleGeometries.map(g => JSON.stringify(g)), 
      lon, 
      lat, 
      radius
    ]);
    this.logger.debug(`FinalRes: ${JSON.stringify(finalRes, null, 2)}`);
    
    return JSON.parse(finalRes.rows[0].final_result);
  }

  private cleanup(id: string) {
    const files = [`mdt_${id}.tif`, `view_${id}.tif`, `poly_${id}.json`].map(f => path.join(this.SHARED_DIR, f));
    files.forEach(f => { if (fs.existsSync(f)) fs.unlinkSync(f); });
  }

  private async runDockerCommand(containerName: string, command: string): Promise<string> {
    const fullCommand = `docker exec ${containerName} ${command}`;

    try {
      this.logger.log(`Executing on ${containerName}: ${command}`);

      const { stdout, stderr } = await execPromise(fullCommand, {
        timeout: 60000, // 1 minute timeout
      });

      if (stderr) {
        this.logger.warn(`Docker Stderr: ${stderr}`);
      }

      return stdout;
    } catch (error) {
      const exitCode = error.code;
      let errorMessage = `Docker Error (${containerName}): `;

      // Specific Docker Exit Codes
      switch (exitCode) {
        case 1:
          errorMessage += "Application error inside container (Check your GIS logic).";
          break;
        case 125:
          errorMessage += "Docker daemon error (Is the socket mounted?).";
          break;
        case 126:
          errorMessage += "Command cannot be invoked (Permission denied).";
          break;
        case 127:
          errorMessage += "Command not found (Is GDAL/GRASS installed in the target container?).";
          break;
        case 137:
          errorMessage += "Container killed (Likely out of memory).";
          break;
        default:
          errorMessage += error.message;
      }

      this.logger.error(errorMessage);
      throw new InternalServerErrorException(errorMessage);
    }
  }
}