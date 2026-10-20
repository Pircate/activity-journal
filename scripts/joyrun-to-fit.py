"""将已核对的悦跑圈原始记录转换为 FIT；原始数据和结果应放在 Git 忽略目录。

依赖 fit-tool、geopy。轨迹时间按等间隔采样及暂停索引还原，并对齐原始起止时间；
这些时间是还原值，不能视为原始逐点时间。
"""

import argparse
import ast
import json
import math
import os
from pathlib import Path

from geopy.distance import geodesic
from fit_tool.fit_file_builder import FitFileBuilder
from fit_tool.profile.messages.activity_message import ActivityMessage
from fit_tool.profile.messages.event_message import EventMessage
from fit_tool.profile.messages.file_id_message import FileIdMessage
from fit_tool.profile.messages.lap_message import LapMessage
from fit_tool.profile.messages.record_message import RecordMessage
from fit_tool.profile.messages.session_message import SessionMessage
from fit_tool.profile.profile_type import Event, EventType, FileType, Manufacturer, Sport, SubSport


def series(value):
    result = ast.literal_eval(value) if value else []
    if not isinstance(result, (list, tuple)):
        raise ValueError('采样数据必须为数组')
    return list(result)


def track_samples(row):
    points = series((row.get('content') or '').replace(']-[', '],['))
    if not points:
        return []
    if row.get('wgs') != 1:
        raise ValueError('轨迹必须来自 wgs=1 的原始详情，不能将偏移坐标当作 WGS84')
    coordinates = []
    for point in points:
        if len(point) != 2 or not all(isinstance(n, (int, float)) and math.isfinite(n) for n in point):
            raise ValueError('轨迹坐标无效')
        lat, lon = (n / 1_000_000 for n in point)
        if not -90 <= lat <= 90 or not -180 <= lon <= 180:
            raise ValueError('轨迹坐标超出范围')
        coordinates.append((lat, lon))
    interval = row['sampleinterval']
    if not isinstance(interval, (int, float)) or interval <= 0:
        raise ValueError('采样间隔无效')
    pauses = {}
    for index, duration in row['pause']:
        index, duration = int(index), int(duration)
        if index < 0 or index >= len(points) or duration < 0 or index in pauses:
            raise ValueError('暂停索引或时长无效')
        pauses[index] = duration
    hr, altitude = series(row.get('heartrate')), series(row.get('altitude'))
    cumulative = [0.0]
    for a, b in zip(coordinates, coordinates[1:]):
        cumulative.append(cumulative[-1] + geodesic(a, b).meters)
    if len(points) < 2 or cumulative[-1] <= 0:
        raise ValueError('轨迹没有可用距离')
    samples = []
    active_span = row['endtime'] - row['starttime'] - sum(pauses.values())
    if active_span <= 0:
        raise ValueError('暂停时长超过活动总历时')
    # 老记录缺少逐点时间，不能把采样缺口全部堆到末点；按等间隔还原并保留已知暂停。
    scale = active_span / ((len(points) - 1) * interval)
    paused = pauses.get(0, 0)
    for index, (lat, lon) in enumerate(coordinates):
        timestamp = row['starttime'] + round(index * interval * scale) + paused
        if samples and timestamp <= samples[-1]['timestamp']:
            raise ValueError('还原的轨迹时间不递增，需要单独复核')
        sample = dict(timestamp=timestamp, lat=lat, lon=lon,
                      distance=row['meter'] * cumulative[index] / cumulative[-1],
                      pause=pauses.get(index + 1, 0))
        if index < len(hr) and isinstance(hr[index], (int, float)) and 0 < hr[index] < 255:
            sample['heart_rate'] = round(hr[index])
        if index < len(altitude) and isinstance(altitude[index], (int, float)) and math.isfinite(altitude[index]):
            sample['altitude'] = altitude[index]
        samples.append(sample)
        paused += sample['pause']
    return samples


def convert(row, target):
    if row.get('type') not in (1, 7):
        raise ValueError('仅导入已确认的户外跑与室内跑')
    for key in ('starttime', 'endtime', 'meter', 'second'):
        if type(row.get(key)) is not int or row[key] < 0:
            raise ValueError(f'{key} 必须为非负整数')
    if not 0 < row['second'] <= row['endtime'] - row['starttime'] or row['meter'] <= 0:
        raise ValueError('距离、运动时长或总历时无效')
    samples = track_samples(row)
    builder = FitFileBuilder(auto_define=True)
    identity = FileIdMessage()
    identity.type = FileType.ACTIVITY
    identity.manufacturer = Manufacturer.DEVELOPMENT.value
    identity.product = 0
    identity.serial_number = int(row['fid'])
    identity.time_created = row['starttime'] * 1000
    builder.add(identity)

    def event(timestamp, kind):
        message = EventMessage()
        message.timestamp = timestamp * 1000
        message.event = Event.TIMER
        message.event_type = kind
        builder.add(message)

    event(row['starttime'], EventType.START)
    if samples and samples[0]['timestamp'] > row['starttime']:
        event(row['starttime'], EventType.STOP)
        event(samples[0]['timestamp'], EventType.START)
    if not samples:
        # 室内跑没有坐标；只写已知的起止时间和累计距离，不生成虚构轨迹。
        samples = [dict(timestamp=row['starttime'], distance=0, pause=0),
                   dict(timestamp=row['endtime'], distance=row['meter'], pause=0)]
    for sample in samples:
        message = RecordMessage()
        message.timestamp = sample['timestamp'] * 1000
        message.distance = sample['distance']
        if 'lat' in sample:
            message.position_lat = sample['lat']
            message.position_long = sample['lon']
        for key in ('heart_rate', 'altitude'):
            if key in sample:
                setattr(message, key, sample[key])
        builder.add(message)
        if sample['pause']:
            if sample['timestamp'] + sample['pause'] >= row['endtime']:
                raise ValueError('暂停超出活动结束时间')
            event(sample['timestamp'], EventType.STOP)
            event(sample['timestamp'] + sample['pause'], EventType.START)
    event(row['endtime'], EventType.STOP_ALL)
    for message in (LapMessage(), SessionMessage()):
        message.timestamp = row['endtime'] * 1000
        message.start_time = row['starttime'] * 1000
        message.sport = Sport.RUNNING
        message.sub_sport = SubSport.TREADMILL if row['type'] == 7 else SubSport.GENERIC
        message.total_distance = row['meter']
        message.total_timer_time = row['second']
        message.total_elapsed_time = row['endtime'] - row['starttime']
        message.avg_speed = row['meter'] / row['second']
        message.event = Event.LAP if isinstance(message, LapMessage) else Event.SESSION
        message.event_type = EventType.STOP
        if isinstance(message, SessionMessage):
            message.first_lap_index = 0
            message.num_laps = 1
        builder.add(message)
    activity = ActivityMessage()
    activity.timestamp = row['endtime'] * 1000
    activity.total_timer_time = row['second']
    activity.num_sessions = 1
    builder.add(activity)
    target = Path(target)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(builder.build_bytes())
    return len(samples)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('raw_directory', type=Path)
    parser.add_argument('plan', type=Path, help='已按用户选择核对的 strava-plan.json')
    parser.add_argument('output_directory', type=Path)
    args = parser.parse_args()
    os.umask(0o077)
    selected = json.loads(args.plan.read_text())['selected']
    seen = set()
    for item in selected:
        fid = item['fid']
        if not isinstance(fid, str) or not fid.isdigit() or fid in seen:
            raise ValueError('选择清单的记录标识无效或重复')
        seen.add(fid)
        row = json.loads((args.raw_directory / f'{fid}.json').read_text())
        if str(row['fid']) != fid:
            raise ValueError('原始记录与选择清单不匹配')
        convert(row, args.output_directory / f'joyrun-{fid}.fit')
    print(f'已转换 {len(seen)} 条跑步；尚未上传。')
