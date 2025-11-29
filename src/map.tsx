// "use client";
// import React, { useCallback, useEffect, useState } from "react";

// // import { useInView } from "react-intersection-observer";

// export interface SliderImage {
//   id: number;
//   attributes: {
//     alternativeText?: string | null;
//     caption?: string | null;
//     url: string;
//     name?: string;
//   };
// }

// export interface SlidShowProps {
//   files?: {
//     data: SliderImage[];
//   };
// }

// export interface MapProps {
//   polygonId?: string | number;
//   polygonName?: string;
// }


// const Map = ({ polygonId, polygonName }: MapProps) => {
//   const [isMapLoaded, setIsMapLoaded] = useState(false);
//   const { ref: mapInViewRef, inView } = useInView({ triggerOnce: false, threshold: 0.25 });

//   const layerId = process.env.NEXT_PUBLIC_GOVMAP_LAYER_ID || "215978";
//   const layerName = "layer_215978";
//   const objectId = String(polygonId ?? "58");

//   useEffect(() => {
//     if (isMapLoaded) return;

//     const jQueryScript = document.createElement("script");
//     jQueryScript.src = "https://code.jquery.com/jquery-1.12.1.min.js";
//     jQueryScript.async = true;
//     document.body.appendChild(jQueryScript);

//     jQueryScript.onload = () => {
//       const govmapScript = document.createElement("script");
//       govmapScript.src = "https://www.govmap.gov.il/govmap/api/govmap.api.js";
//       govmapScript.async = true;
//       document.body.appendChild(govmapScript);

//       govmapScript.onload = () => {
//         const gm = (window as any).govmap;
//         if (!gm) return;
        
//         gm.createMap("map", {
//           token: process.env.NEXT_PUBLIC_GOVMAP_TOKEN,
//           layers: ["SUB_GUSH_ALL", "PARCEL_ALL", "layer_215978"],
//           showXY: true,
//           identifyOnClick: false,
//           isEmbeddedToggle: false,
//           background: 2,
//           layersMode: 1,
//           zoomButtons: true,
//           onLoad: async () => {
//             const shouldFallback = await showPolygon();
//             if (shouldFallback) {
//               const result = await showPolygonGeometry("auto-effect");
//               if (result && typeof result.x === 'number' && typeof result.y === 'number') {
//                 console.log("zoomToXY");
//                 gm.zoomToXY({ x: result.x, y: result.y, level: 7, marker: false });
//               }
//             }
//             setIsMapLoaded(true);
//           }
//         });
//       };
//     };

//     return () => {
//       document.querySelectorAll("script[src*='govmap']").forEach((s) => s.remove());
//       document.querySelectorAll("script[src*='jquery']").forEach((s) => s.remove());
//     };
//   }, [isMapLoaded]);

//   //show polygon by name
//   const showPolygon = useCallback(async (): Promise<boolean> => {   
//     console.log("showPolygon");
//     const gm = (window as any).govmap;
//     if (!gm || !polygonId || !polygonName) return true;
//     try {
//       let fieldName = "value1";
//       const res: any = await gm.searchInLayer({ layerName, fieldName, fieldValues: [polygonName], highlight: true});
//       console.log("searchInLayer response",layerName, "value1", polygonName, res);
//       const hasData = Array.isArray(res?.data) && res.data.length > 0;
//       //if no data, try to search by id
//       if (!hasData) {
//        fieldName = "objectId";
//        const res: any = await gm.searchInLayer({ layerName, fieldName, fieldValues: [polygonId]});
//        console.log("searchInLayer response",layerName,polygonId, res);
//        const hasData = Array.isArray(res?.data) && res.data.length > 0;
//        //if no data, return false
//        if (!hasData) {
//         return true;
//        }
//       }
//       return !hasData; // fallback only when no results
//     } catch (e) {
//       console.error('searchInLayer error', e);
//       return true; // fallback on error
//     }
//   }, [polygonId, isMapLoaded, inView, polygonName]);

//   //show polygon by id
//   const showPolygonGeometry = useCallback(async (origin: string) => {
//     console.log("showPolygonGeometry");
    
//     const gm = (window as any).govmap;
//     if (!gm || !polygonId) return;

//    const response = await fetch("https://www.govmap.gov.il/api/user-layers/entities-geometry", {
//       method: "POST",
//       headers: { "Content-Type": "application/json" },
//       body: JSON.stringify({ layerId, objectIds: [objectId] }),
//     });
//     const data = await response.json();

//     const geom = data && data[0] && data[0].geometry;
//     if (!geom) return;
//     let coords = geom.type === 'MultiPolygon' ? geom.coordinates[0][0] : geom.coordinates[0];
//     if (!coords || !coords.length) return;
//     const first = coords[0];
//     const last = coords[coords.length - 1];
//     if (first[0] !== last[0] || first[1] !== last[1]) coords = coords.concat([first]);
//     const wkt = 'POLYGON((' + coords.map((p: number[]) => p[0] + ' ' + p[1]).join(', ') + '))';

//     let x = 0, y = 0, area = 0;
//     for (let i = 0, len = coords.length - 1; i < len; i++) {
//       const [x0, y0] = coords[i];
//       const [x1, y1] = coords[i + 1];
//       const a = x0 * y1 - x1 * y0;
//       area += a;
//       x += (x0 + x1) * a;
//       y += (y0 + y1) * a;
//     }
//     area = area / 2;
//     if (area === 0) return { wkt, x: coords[0][0], y: coords[0][1] }; 
//     x = x / (6 * area);
//     y = y / (6 * area);

//     return { wkt, x, y };
//   }, [polygonId, isMapLoaded, inView]);

//   return (
//     <div className="group relative h-[calc(60vh-60px)] w-full overflow-hidden rounded-lg transition-all duration-500 hover:shadow-2xl md:h-[calc(60vh-60px)] lg:h-[calc(70vh-70px)] xl:h-[32rem]">
//       <div 
//         id="map" 
//         className="h-full w-full transition-transform duration-700 ease-out group-hover:scale-[1.02]" 
//         ref={mapInViewRef} 
//       />
//       {!isMapLoaded && (
//         <div className="absolute inset-0 flex items-center justify-center bg-muted/50 backdrop-blur-sm">
//           <div className="flex flex-col items-center gap-3">
//             <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
//             <p className="text-sm text-muted-foreground">Loading map...</p>
//           </div>
//         </div>
//       )}
//     </div>
//   );
// };

// export default Map;

