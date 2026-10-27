// 公开数据保存平台代码与数值，中文名称和单位只用于展示。
export const sports = {
  Ride:'骑行', VirtualRide:'虚拟骑行', EBikeRide:'电助力骑行', EMountainBikeRide:'电助力山地骑行',
  MountainBikeRide:'山地骑行', GravelRide:'砾石骑行', Handcycle:'手摇自行车', Velomobile:'卧式骑行',
  Run:'跑步', VirtualRun:'虚拟跑步', TrailRun:'越野跑', Walk:'步行', Hike:'徒步', Swim:'游泳',
  WeightTraining:'力量训练', Workout:'体能训练', Yoga:'瑜伽', Pilates:'普拉提', Rowing:'划船',
  VirtualRow:'虚拟划船', Elliptical:'椭圆机', StairStepper:'踏步机', RockClimbing:'攀岩',
  NordicSki:'越野滑雪', AlpineSki:'高山滑雪', BackcountrySki:'野外滑雪', Snowboard:'单板滑雪',
  Kayaking:'皮划艇', Canoeing:'划独木舟', StandUpPaddling:'桨板', Surfing:'冲浪',
  Soccer:'足球', Tennis:'网球', Badminton:'羽毛球', Basketball:'篮球', Golf:'高尔夫',
};
export const sportLabel = sport => Object.hasOwn(sports, sport) ? sports[sport] : `其他运动（${sport}）`;
export const distanceApplies = activity => activity.sport !== 'WeightTraining';
export const isRide = sport => ['Ride', 'VirtualRide', 'EBikeRide', 'EMountainBikeRide', 'MountainBikeRide', 'GravelRide', 'Handcycle', 'Velomobile'].includes(sport);
export const hasMissingMetric = activity => (distanceApplies(activity) ? activity.distanceKm === null : activity.sets === null || activity.averageHeartRate === null) || activity.trainingLoad === null;

export function summarizeActivities(records) {
  const applicable = records.filter(distanceApplies);
  const distance = applicable.filter(activity => activity.distanceKm !== null);
  const load = records.filter(activity => activity.trainingLoad !== null);
  return {
    count:records.length,
    distanceKm:applicable.length && !distance.length ? null : distance.reduce((sum, activity) => sum + activity.distanceKm, 0),
    durationSeconds:records.reduce((sum, activity) => sum + activity.durationSeconds, 0),
    trainingLoad:records.length && !load.length ? null : load.reduce((sum, activity) => sum + activity.trainingLoad, 0),
    missingDistance:applicable.length - distance.length,
    missingLoad:records.length - load.length,
    missingMetrics:records.filter(hasMissingMetric).length,
  };
}
