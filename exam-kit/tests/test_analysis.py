import argparse
import contextlib
import io
import json
import math
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np
import pandas as pd
from scipy import stats
import analysis as a


class NumericTests(unittest.TestCase):
    def test_percentage_with_missing_keeps_scale(self):
        result = a.to_numeric_safe(pd.Series(['12.5%'] * 8 + [None] * 2))
        np.testing.assert_allclose(result.iloc[:8], .125)
        self.assertTrue(result.iloc[8:].isna().all())

    def test_percentage_fullwidth_and_negative(self):
        np.testing.assert_allclose(a.to_numeric_safe(pd.Series(['12.5％', '(10%)'])), [.125, -.1])

    def test_ambiguous_percentage_units_rejected(self):
        with self.assertRaisesRegex(ValueError, '统一单位'):
            a.to_numeric_safe(pd.Series(['12.5%', '12.5']))

    def test_money_and_single_valid_value(self):
        np.testing.assert_allclose(a.to_numeric_safe(pd.Series(['1,234 元', '￥88.5', '(88)'])), [1234, 88.5, -88])
        self.assertEqual(a.to_numeric_safe(pd.Series(['12.5%', None])).iloc[0], .125)

    def test_nonfinite_and_all_empty_columns(self):
        df = a.clean_frame(pd.DataFrame({'金额': [1., np.inf, -np.inf], '全空': [None] * 3}))
        self.assertEqual(df['金额'].notna().sum(), 1)
        self.assertIn('全空', df.columns)
        self.assertTrue(df.attrs['cleaning_notes'])

    def test_id_preserved_and_not_used_as_metric(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'ids.csv'
            path.write_text('用户ID,是否复购\n001,0\n002,1\n003,0\n')
            df = a.clean_frame(a.read_any_csv(path))
        self.assertEqual(df['用户ID'].tolist(), ['001', '002', '003'])
        self.assertEqual(a.detect_metrics(df, set()), ['是否复购'])
        self.assertFalse(a.is_identifier('paid'))
        self.assertTrue(a.is_identifier('userId'))

    def test_gbk_semicolon(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'data.csv'
            path.write_bytes('渠道;金额\n搜索;1,234\n直播;88.5\n'.encode('gbk'))
            df = a.clean_frame(a.read_any_csv(path))
        self.assertEqual(df['金额'].tolist(), [1234, 88.5])

    def test_duplicate_headers_rejected(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'data.csv'
            path.write_text('金额, 金额\n1,2\n')
            with self.assertRaisesRegex(ValueError, '重复列名'):
                a.read_any_csv(path)

    def test_binary_and_constant_metrics_are_candidates(self):
        for values in ([0, 1] * 20, [0] * 40, [1] * 40):
            df = a.clean_frame(pd.DataFrame({'是否复购': values}))
            self.assertEqual(a.detect_metrics(df, set()), ['是否复购'])


class CsvStructureTests(unittest.TestCase):
    def read_text(self, text, encoding='utf-8'):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'data.csv'
            path.write_bytes(text.encode(encoding))
            return a.read_any_csv(path)

    def test_extra_and_missing_fields_rejected(self):
        for rows in ('001,10,999\n002,20,888\n', '001,10\n002,20,888\n', '001,10\n002\n'):
            with self.subTest(rows=rows), self.assertRaisesRegex(ValueError, '行结构不一致'):
                self.read_text('用户ID,金额\n' + rows)

    def test_empty_header_or_column_name_rejected(self):
        for text in ('', '\n', '用户ID,\n001,10\n', '用户ID,  \n001,10\n'):
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, '表头为空或含空列名'):
                self.read_text(text)

    def test_quoted_delimiters_newlines_and_escaped_quotes(self):
        df = self.read_text('用户ID,备注,金额\n001,"搜索,直播\n含""引号""",10\n\n002,普通,20\n')
        self.assertEqual(df.shape, (2, 3))
        self.assertEqual(df['用户ID'].tolist(), ['001', '002'])
        self.assertEqual(df['备注'].iloc[0], '搜索,直播\n含"引号"')
        self.assertEqual(df['金额'].tolist(), ['10', '20'])

    def test_unterminated_quote_rejected(self):
        with self.assertRaisesRegex(ValueError, 'CSV 解析失败'):
            self.read_text('用户ID,备注\n001,"未闭合\n')

    def test_literal_na_and_null_preserved_and_only_blanks_missing(self):
        df = a.clean_frame(self.read_text('用户ID,渠道,金额\nNA,NA,10\nNULL,NULL,20\n,  ,30\n'))
        self.assertEqual(df['用户ID'].iloc[:2].tolist(), ['NA', 'NULL'])
        self.assertEqual(df['渠道'].iloc[:2].tolist(), ['NA', 'NULL'])
        self.assertTrue(df.loc[2, ['用户ID', '渠道']].isna().all())
        self.assertEqual(df['金额'].sum(), 60)

    def test_single_column_quoted_empty_record_preserved(self):
        df = self.read_text('金额\n1\n""\n\n2\n')
        self.assertEqual(df['金额'].tolist(), ['1', '', '2'])

    def test_utf16_tab_and_pipe_delimiters(self):
        for sep, encoding in (('\t', 'utf-16'), ('|', 'utf-8-sig')):
            with self.subTest(sep=sep, encoding=encoding):
                df = self.read_text(f'用户ID{sep}金额\n001{sep}10\n002{sep}20\n', encoding)
                self.assertEqual(df['用户ID'].tolist(), ['001', '002'])
                self.assertEqual(df['金额'].tolist(), ['10', '20'])


class DateTests(unittest.TestCase):
    def frame(self):
        return pd.DataFrame({'日期': pd.date_range('2024-01-01', periods=40).strftime('%Y%m%d').astype(int),
                             '渠道': ['A', 'B'] * 20, '金额': np.arange(200, 240, dtype=float)})

    def test_integer_dates_have_correct_span(self):
        frame = self.frame()
        self.assertEqual(a.detect_date(frame), '日期')
        dates = a.parse_dates(frame['日期'])
        self.assertEqual(dates.min().strftime('%Y-%m-%d'), '2024-01-01')
        self.assertEqual(dates.max().strftime('%Y-%m-%d'), '2024-02-09')
        self.assertEqual(a.analyze_time(frame, '金额', '日期', '渠道', 'A')['span_days'], 39)

    def test_numeric_missing_invalid_and_unix_not_guessed(self):
        parsed = a.parse_dates(pd.Series([20240229., None, 20240230., 1704067200.]))
        self.assertEqual(parsed.notna().tolist(), [True, False, False, False])
        self.assertEqual(parsed.iloc[0].strftime('%Y-%m-%d'), '2024-02-29')

    def test_mixed_dates_and_months(self):
        parsed = a.parse_dates(pd.Series(['202401', '2024/02/01', '2024-03-01', None]))
        self.assertEqual(parsed.iloc[:3].dt.strftime('%Y-%m-%d').tolist(), ['2024-01-01', '2024-02-01', '2024-03-01'])

    def test_small_year_codes_do_not_crash_date_detection(self):
        frame = pd.DataFrame({'账户': ['0001', '0002', '0003']})
        self.assertIsNone(a.detect_date(frame))

    def test_explicit_roles_excluded_from_date_detection(self):
        frame = pd.DataFrame({'账户': ['20240101', '20240102', '20240103']})
        self.assertIsNone(a.detect_date(frame, {'账户'}))

    def test_same_day_not_split_and_row_order_invariant(self):
        frame = pd.DataFrame({'日期': ['2024-01-01'] * 35 + ['2024-01-02'] * 35 + ['2024-01-03'] * 30,
                              '渠道': ['A', 'B'] * 50, '金额': np.arange(100, dtype=float)})
        result = a.analyze_time(frame, '金额', '日期', '渠道', 'A')
        shuffled = a.analyze_time(frame.sample(frac=1, random_state=42), '金额', '日期', '渠道', 'A')
        self.assertEqual(result, shuffled)
        self.assertLess(result['slices'][0]['end'], result['slices'][1]['start'])
        self.assertEqual(sum(s['n'] for s in result['slices']), 100)

    def test_insufficient_focus_not_called_stable(self):
        frame = self.frame()
        frame['渠道'] = ['A'] + ['B'] * 39
        result = a.analyze_time(frame, '金额', '日期', '渠道', 'A')
        self.assertFalse(result['assessed'])
        self.assertIsNone(result['sign_flip'])

    def test_small_difference_not_rounded_before_flip_check(self):
        frame = self.frame()
        frame['金额'] = [.00100002, .001] * 10 + [.00099998, .001] * 10
        result = a.analyze_time(frame, '金额', '日期', '渠道', 'A')
        self.assertTrue(result['sign_flip'])
        self.assertGreater(result['slices'][0]['focus_difference'], 0)
        self.assertLess(result['slices'][1]['focus_difference'], 0)


class StatisticsTests(unittest.TestCase):
    def test_lower_cost_sorting_and_no_weak_label(self):
        frame = pd.DataFrame({'渠道': ['A'] * 20 + ['B'] * 20,
                              '成本': list(range(200, 220)) + list(range(100, 120))})
        result = a.analyze_segments(frame, '成本', '渠道', direction='lower')
        self.assertEqual(result['levels'][0]['level'], 'B')
        self.assertEqual(result['levels'][0]['difference'], -50)
        findings = a.build_findings(result, None, None, [], [], frame)
        self.assertNotIn('最弱', json.dumps(findings, ensure_ascii=False))
        self.assertNotIn('confidence', findings[0])

    def test_zero_and_negative_reference_have_no_relative_percentage(self):
        for values in ([-1.] * 10 + [1.] * 10, [-2.] * 10 + [-1.] * 10):
            result = a.analyze_segments(pd.DataFrame({'g': ['A'] * 10 + ['B'] * 10, 'v': values}), 'v', 'g')
            self.assertTrue(all(lv['lift_pct'] is None for lv in result['levels']))
            self.assertTrue(all(lv['value_share_pct'] is None for lv in result['levels']))

    def test_missing_metric_denominator(self):
        frame = pd.DataFrame({'g': ['A', 'A', 'B', 'B'], 'v': [1, None, 2, 3]})
        result = a.analyze_segments(frame, 'v', 'g')
        self.assertEqual(result['n_total'], 3)
        self.assertAlmostEqual(sum(lv['row_share_pct'] for lv in result['levels']), 100, places=2)
        self.assertEqual(result['baseline_mean'], 2)

    def test_p_value_not_rounded_before_bonferroni(self):
        left = np.arange(20, dtype=float)
        target_p = .02498
        delta = stats.t.isf(target_p / 2, 38) * math.sqrt(2 * left.var(ddof=1) / 20)
        frame = pd.DataFrame({'g': ['A'] * 20 + ['B'] * 20, 'v': np.r_[left, left + delta]})
        result = a.analyze_segments(frame, 'v', 'g', inference={'enabled': True, 'reason': '独立样本'})
        for row in result['levels']:
            self.assertAlmostEqual(row['p_value'], target_p, places=10)
            self.assertTrue(row['significant_bonferroni'])
            self.assertAlmostEqual(row['p_adjusted'], target_p * 2, places=10)

    def test_single_constant_group_welch_is_valid(self):
        left, right = pd.Series([0.] * 10), pd.Series(np.arange(1., 11.))
        self.assertAlmostEqual(a.welch_p(left, right), stats.ttest_ind(left, right, equal_var=False).pvalue)
        self.assertTrue(math.isnan(a.welch_p(left, left)))

    def test_repeated_users_disable_inference_even_when_flag_is_set(self):
        frame = a.clean_frame(pd.DataFrame({'用户ID': ['u1'] * 20 + ['u2'] * 20, '金额': range(40)}))
        self.assertEqual(a.detect_entity(frame, {'金额'}), '用户ID')
        policy = a.inference_policy(frame, argparse.Namespace(independent_rows=True), False, False, '用户ID')
        self.assertFalse(policy['enabled'])
        self.assertIn('重复出现', policy['reason'])

    def test_auto_selection_disables_inference(self):
        frame = pd.DataFrame({'v': [1., 2., 3.]})
        policy = a.inference_policy(frame, argparse.Namespace(independent_rows=True), True, False, None)
        self.assertFalse(policy['enabled'])

    def test_missing_scipy_never_uses_normal_approximation(self):
        with patch.object(a, 'HAS_SCIPY', False):
            self.assertTrue(math.isnan(a.welch_p(pd.Series(range(10)), pd.Series(range(1, 11)))))
            policy = a.inference_policy(pd.DataFrame({'v': [1, 2]}), argparse.Namespace(independent_rows=True), False, False, None)
        self.assertFalse(policy['enabled'])

    def test_rate_differences_have_percentage_points_not_sum(self):
        frame = pd.DataFrame({'g': ['A'] * 10 + ['B'] * 10, 'v': [.1] * 10 + [.2] * 10})
        result = a.analyze_segments(frame, 'v', 'g', metric_kind='rate')
        self.assertEqual(result['levels'][0]['difference_pp'], 5)
        self.assertIsNone(result['levels'][0]['total'])

    def test_negative_values_do_not_get_concentration_shares(self):
        frame = pd.DataFrame({'id': ['a', 'b'], 'v': [-10, 11]})
        self.assertIsNone(a.analyze_concentration(frame, 'v', 'id'))


class IntegrationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        (self.root / 'data').mkdir()
        self.patchers = [patch.object(a, 'ROOT', self.root), patch.object(a, 'DATA_DIR', self.root / 'data'), patch.object(a, 'OUT_DIR', self.root / 'out')]
        for patcher in self.patchers:
            patcher.start()

    def tearDown(self):
        for patcher in reversed(self.patchers):
            patcher.stop()
        self.temp.cleanup()

    def run_analysis(self, frame, *args):
        path = self.root / 'data' / 'fixture.csv'
        frame.to_csv(path, index=False)
        with contextlib.redirect_stdout(io.StringIO()):
            a.main(['--file', str(path), *args])
        return json.loads((self.root / 'out' / 'metrics.json').read_text())

    def test_integer_dates_overview_consistent_and_html_generated(self):
        frame = DateTests().frame()
        result = self.run_analysis(frame)
        self.assertEqual(result['overview']['date_range'], ['2024-01-01', '2024-02-09'])
        self.assertEqual(result['time']['span_days'], 39)
        self.assertEqual(result['baseline']['mean'], 219.5)
        self.assertTrue((self.root / 'index.html').is_file())
        self.assertNotIn(str(self.root), result['reproduce_command'])

    def test_binary_csv_runs_and_title_does_not_change_definition(self):
        frame = pd.DataFrame({'是否复购': [0, 1] * 20, '渠道': ['A', 'A', 'B', 'B'] * 10})
        result = self.run_analysis(frame, '--title', '业务待确认')
        self.assertEqual(result['overview']['metric'], '是否复购')
        self.assertEqual(result['overview']['metric_kind'], 'binary')
        self.assertEqual(result['baseline']['mean'], .5)
        self.assertTrue(result['selection']['metric_auto'])
        self.assertFalse(result['inference']['enabled'])

    def test_low_count_percent_csv_and_null_profile(self):
        frame = pd.DataFrame({'转化率': ['12.5%'] * 8 + [None] * 2, '全空': [None] * 10})
        result = self.run_analysis(frame)
        self.assertEqual(result['baseline']['mean'], .125)
        self.assertEqual(result['baseline']['n'], 8)
        self.assertIn('全空', [row['name'] for row in result['profile']])

    def test_explicit_entity_preserves_leading_zero_identity(self):
        frame = pd.DataFrame({'账户': ['0001', '1'] + [str(i) for i in range(2, 12)],
                              '渠道': ['A'] * 6 + ['B'] * 6, '金额': range(12)})
        result = self.run_analysis(frame, '--metric', '金额', '--group', '渠道', '--entity', '账户', '--independent-rows')
        entity_profile = next(row for row in result['profile'] if row['name'] == '账户')
        self.assertEqual(entity_profile['nunique'], 12)
        self.assertTrue(result['inference']['enabled'])

    def test_explicit_group_preserves_distinct_numeric_codes(self):
        frame = pd.DataFrame({'组别': ['01', '1'] * 6, '金额': range(12)})
        result = self.run_analysis(frame, '--metric', '金额', '--group', '组别')
        self.assertEqual({row['level'] for row in result['segments']['levels']}, {'01', '1'})

    def test_malformed_csv_clears_stale_results(self):
        self.run_analysis(pd.DataFrame({'金额': [1., 2.]}))
        path = self.root / 'data' / 'fixture.csv'
        path.write_text('用户ID,金额\n001,10,999\n002,20,888\n')
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
            a.main(['--file', str(path)])
        self.assertEqual(error.exception.code, 1)
        self.assertFalse((self.root / 'out' / 'metrics.json').exists())
        self.assertFalse((self.root / 'index.html').exists())
        self.assertIn('行结构不一致', (self.root / 'out' / 'FAILED.txt').read_text())

    def test_no_html_removes_previous_page_and_screenshot(self):
        (self.root / 'index.html').write_text('stale')
        (self.root / 'preview.png').write_bytes(b'stale')
        self.run_analysis(pd.DataFrame({'金额': [1., 2.]}), '--no-html')
        self.assertFalse((self.root / 'index.html').exists())
        self.assertFalse((self.root / 'preview.png').exists())

    def test_invalid_metric_removes_stale_results(self):
        self.run_analysis(pd.DataFrame({'金额': [1., 2.]}))
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
            a.main(['--file', str(self.root / 'data' / 'fixture.csv'), '--metric', '不存在'])
        self.assertEqual(error.exception.code, 1)
        self.assertFalse((self.root / 'out' / 'metrics.json').exists())
        self.assertFalse((self.root / 'index.html').exists())
        self.assertTrue((self.root / 'out' / 'FAILED.txt').exists())

    def test_multiple_csv_requires_explicit_selection(self):
        for name in ('a.csv', 'b.csv'):
            (self.root / 'data' / name).write_text('金额\n1\n')
        with self.assertRaisesRegex(ValueError, '--file'):
            a.pick_file(None)

    def test_single_group_does_not_claim_a_test_was_run(self):
        result = self.run_analysis(pd.DataFrame({'金额': range(30), '渠道': ['A'] * 30}),
                                   '--metric', '金额', '--group', '渠道', '--independent-rows')
        self.assertFalse(result['inference']['enabled'])
        self.assertIsNone(result['segments'])

    def test_render_escapes_title_and_does_not_replace_embedded_tokens(self):
        payload = {'title': '</title><img src=x onerror=alert(1)>__DATA__', 'generated_at': 'today'}
        page = a.render_html('<title>__TITLE__</title><script type="application/json">__DATA__</script>', payload)
        self.assertNotIn('<img', page.split('</title>')[0])
        self.assertIn('&lt;img', page)
        self.assertIn('__DATA__', page)


if __name__ == '__main__':
    unittest.main()
