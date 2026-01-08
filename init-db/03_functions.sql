CREATE OR REPLACE FUNCTION VIEWSHED(
    IN center geometry,
    IN polygons geometry[],
    IN radius double precision DEFAULT 150,
    IN rays integer DEFAULT 36,
    IN heading integer DEFAULT -999,
    IN fov integer DEFAULT 360
    )
RETURNS geometry  AS $$
DECLARE
    arc numeric;
    angle_0 numeric;
    geomout geometry;
BEGIN
    arc := fov::numeric / rays::numeric;
    IF fov = 360 THEN
        angle_0 := 0;
    ELSE
        angle_0 := heading - 0.5 * fov;
    END IF;

    WITH
    buildings_0 AS(
        SELECT
            t.geom
        FROM unnest(polygons) as t(geom)
    ),
   buildings_crop AS(
        SELECT
            geom
        FROM buildings_0
        WHERE ST_DWithin(center::geography, geom::geography, radius)
    ),
    buildings AS(
        SELECT geom FROM buildings_crop
        UNION ALL
        SELECT ST_buffer(center::geography, radius)::geometry as geom
    ),
    rays AS(
        SELECT
            t.n as id,
            ST_SetSRID(
                ST_MakeLine(
                    center,
                    ST_Project(
                       center::geography,
                       radius + 1,
                       radians(angle_0 + t.n::numeric * arc)
                    )::geometry
                ),
             4326) AS geom
        FROM generate_series(0, rays) as t(n)
    ),
    intersections AS(
        SELECT
            r.id,
            (ST_Dump(ST_Intersection(ST_Boundary(b.geom),r.geom))).geom AS point
        FROM
            rays r
        LEFT JOIN
            buildings b
        ON
            ST_Intersects(b.geom,r.geom)
    ),
    intersections_distances AS(
        SELECT
            id,
            point as geom,
            row_number() over(partition by id order by center <-> point) as ranking
        FROM intersections
    ),
    intersection_closest AS(
        SELECT
            -1 as id,
            CASE WHEN fov = 360 THEN null::geometry ELSE center END as geom
        UNION ALL
        (SELECT
            id,
            geom
        FROM intersections_distances
        WHERE ranking = 1
        ORDER BY ID)
        UNION ALL
        SELECT
            999999 as id,
            CASE WHEN fov = 360 THEN null::geometry  ELSE center END as geom
    ),
    isovist_0 AS(
        SELECT
            ST_MakePolygon(ST_MakeLine(geom)) as geom
        FROM intersection_closest
    ),
    isovist_buildings AS(
        SELECT
            ST_CollectionExtract(ST_union(b.geom),3) as geom
        FROM
            isovist_0 i,
            buildings_crop b
        WHERE ST_Intersects(b.geom,i.geom)
    )
    SELECT
        coalesce(ST_Difference(i.geom, b.geom), i.geom) into geomout
    FROM
        isovist_0 i,
        isovist_buildings b;

    RETURN geomout;
END;
$$ language plpgsql IMMUTABLE;