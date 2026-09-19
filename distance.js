const EARTH_RADIUS_METERS = 6_371_000;
const METERS_PER_MILE = 1_609.344;

const radians = degrees => degrees * Math.PI / 180;

export function distanceBetween([fromLatitude, fromLongitude], [toLatitude, toLongitude]) {
  const latitudeDelta = radians(toLatitude - fromLatitude);
  const longitudeDelta = radians(toLongitude - fromLongitude);
  const fromLatitudeRadians = radians(fromLatitude);
  const toLatitudeRadians = radians(toLatitude);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(fromLatitudeRadians) * Math.cos(toLatitudeRadians)
    * Math.sin(longitudeDelta / 2) ** 2;

  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.sqrt(haversine));
}

export function formatDistance(meters) {
  return `${(meters / METERS_PER_MILE).toFixed(2)} mi`;
}
