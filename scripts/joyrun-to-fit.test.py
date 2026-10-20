"""用 Garmin 官方解码器独立检查悦跑圈 FIT 转换结果。"""

import importlib.util
import tempfile
import unittest
from pathlib import Path

from garmin_fit_sdk import Decoder, Stream

spec = importlib.util.spec_from_file_location('joyrun_to_fit', Path(__file__).with_name('joyrun-to-fit.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ConversionTests(unittest.TestCase):
    def setUp(self):
        self.row = dict(fid=42, type=1, starttime=1593772753, endtime=1593772774,
                        second=20, meter=120, sampleinterval=5, wgs=1, pause=[['1', '1']],
                        content='[31800000,117200000]-[31800100,117200100]-[31800200,117200200]',
                        heartrate='[120,0,125]', altitude='[10,11,12]')

    def decode(self, row):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'activity.fit'
            module.convert(row, path)
            decoder = Decoder(Stream.from_file(str(path)))
            self.assertTrue(decoder.check_integrity())
            messages, errors = Decoder(Stream.from_file(str(path))).read()
            self.assertEqual(errors, [])
            return messages

    def test_outdoor_preserves_coordinates_and_summary(self):
        messages = self.decode(self.row)
        session = messages['session_mesgs'][0]
        self.assertEqual(session['total_distance'], 120)
        self.assertEqual(session['total_timer_time'], 20)
        self.assertEqual(session['total_elapsed_time'], 21)
        self.assertEqual(int(session['start_time'].timestamp()), self.row['starttime'])
        records = messages['record_mesgs']
        self.assertEqual(len(records), 3)
        self.assertEqual([int(r['timestamp'].timestamp()) for r in records],
                         [self.row['starttime'], self.row['starttime'] + 11, self.row['endtime']])
        self.assertEqual(records[-1]['distance'], 120)
        self.assertNotIn('heart_rate', records[1])
        self.assertEqual(records[-1]['heart_rate'], 125)
        self.assertAlmostEqual(records[0]['position_lat'] * 180 / 2**31, 31.8, places=6)

    def test_indoor_has_no_invented_coordinates(self):
        messages = self.decode({**self.row, 'type':7, 'content':'', 'pause':[]})
        self.assertEqual(messages['session_mesgs'][0]['sub_sport'], 'treadmill')
        self.assertEqual(len(messages['record_mesgs']), 2)
        self.assertTrue(all('position_lat' not in r for r in messages['record_mesgs']))

    def test_invalid_times_and_metrics_are_rejected(self):
        for override in ({'second':22}, {'meter':-1}, {'type':2}, {'sampleinterval':0}, {'wgs':0},
                         {'pause':[['1','-1']]}, {'content':'[999000000,117200000]-[31800100,117200100]'}):
            with self.subTest(override=override), self.assertRaises(ValueError):
                self.decode({**self.row, **override})

    def test_initial_pause_and_sampling_gaps_keep_time_order(self):
        messages = self.decode({**self.row, 'pause':[['0','2']]})
        times = [int(r['timestamp'].timestamp()) for r in messages['record_mesgs']]
        self.assertEqual(times[0], self.row['starttime'] + 2)
        self.assertEqual(times[-1], self.row['endtime'])
        self.assertEqual(times, sorted(set(times)))

    def test_sampling_data_cannot_execute_code(self):
        with self.assertRaises(ValueError):
            module.series('__import__("os").getcwd()')


if __name__ == '__main__':
    unittest.main()
