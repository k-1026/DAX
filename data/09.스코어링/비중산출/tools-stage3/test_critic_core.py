"""Numerical and boundary contracts derived from stage2, not implementation mirrors."""
import math
import unittest
from critic_core import fit_critic, rent_burden, quantile_linear, display_percentages

class CriticContracts(unittest.TestCase):
    def test_negative_correlation_kept_in_three_factor_hand_example(self):
        rows = [dict(id='1', a=0, b=0, c=100), dict(id='2', a=50, b=100, c=0), dict(id='3', a=100, b=0, c=100)]
        r = fit_critic(rows, ['a','b','c'], [30,40,30])
        # Hand-derived: SD=(1/2,1/sqrt(3),1/sqrt(3)), conflict sums=(2,3,3).
        expected_a = 100/(1+2*math.sqrt(3))
        self.assertAlmostEqual(r['candidateWeights']['a'], expected_a, places=10)
        self.assertAlmostEqual(r['candidateWeights']['b'], (100-expected_a)/2, places=10)
        self.assertAlmostEqual(r['correlation']['b']['c'], -1, places=12)

    def test_same_complete_case_rows_for_all_columns(self):
        rows=[dict(id='1',a=0,b=0),dict(id='2',a=50,b=100),dict(id='3',a=100,b=0),dict(id='4',a=90,b=None),dict(id='5',a=None,b=20)]
        r=fit_critic(rows,['a','b'],[40,60])
        self.assertEqual(r['completeCaseIds'],['1','2','3'])
        self.assertEqual(r['missingPerFactor'],{'a':1,'b':1})
        self.assertAlmostEqual(r['candidateWeights']['a'],46.41016151377546,places=10)
        self.assertEqual(r['status'],'two_factor_sd_ratio')

    def test_perfect_positive_correlation_does_not_invent_weights(self):
        rows=[dict(id='1',a=10,b=20),dict(id='2',a=20,b=40),dict(id='3',a=30,b=60)]
        r=fit_critic(rows,['a','b'],[30,70])
        self.assertIsNone(r['candidateWeights'])
        self.assertEqual(r['status'],'cannot_estimate_zero_information')
        self.assertEqual(r['fallbackWeights'],{'a':30,'b':70})

    def test_constant_factor_does_not_fake_correlation(self):
        rows=[dict(id='1',a=50,b=0),dict(id='2',a=50,b=100)]
        r=fit_critic(rows,['a','b'],[40,60])
        self.assertEqual(r['constantFactors'],['a'])
        self.assertEqual(r['candidateWeights'],{'a':0,'b':100})
        self.assertEqual(r['status'],'single_factor')

    def test_all_constant_is_unestimable(self):
        r=fit_critic([dict(id='1',a=50,b=50),dict(id='2',a=50,b=50)],['a','b'],[40,60])
        self.assertIsNone(r['candidateWeights'])
        self.assertEqual(r['status'],'cannot_estimate_all_constant')

    def test_nonfinite_or_out_of_range_is_not_silently_dropped(self):
        for bad in [float('nan'),float('inf'),-1,101]:
            with self.subTest(bad=bad),self.assertRaises(ValueError):
                fit_critic([dict(id='1',a=bad,b=None),dict(id='2',a=10,b=20)],['a','b'],[40,60])

    def test_insufficient_sample_not_reported_as_estimated(self):
        r=fit_critic([dict(id='1',a=20,b=30)],['a','b'],[30,70])
        self.assertIsNone(r['candidateWeights'])
        self.assertEqual(r['status'],'cannot_estimate_insufficient_n')

    def test_minmax_comparison_changes_dispersion_scale_only(self):
        rows=[dict(id='1',a=0,b=0),dict(id='2',a=25,b=20),dict(id='3',a=50,b=0)]
        fixed=fit_critic(rows,['a','b'],[50,50])
        mm=fit_critic(rows,['a','b'],[50,50],normalization='sample_minmax')
        self.assertAlmostEqual(mm['candidateWeights']['a'],46.41016151377546,places=10)
        self.assertGreater(fixed['candidateWeights']['a']-mm['candidateWeights']['a'],20)
        self.assertEqual(fixed['completeCaseIds'],mm['completeCaseIds'])

    def test_rent_budget_edges_match_existing_interpolation(self):
        for total,budget,expected in [(0,300,100),(150,300,100),(225,300,70),(300,300,40),(301,300,None),(225,None,None)]:
            with self.subTest(total=total,budget=budget):
                self.assertEqual(rent_burden(total,budget),expected)
        with self.assertRaises(ValueError): rent_burden(-1,300)
        with self.assertRaises(ValueError): rent_burden(100,0)

    def test_percentiles_use_linear_interpolation(self):
        self.assertEqual(quantile_linear([0,100,200,300],0.25),75)
        self.assertEqual(quantile_linear([0,100,200,300],0.5),150)
        self.assertEqual(quantile_linear([10],0.75),10)

    def test_display_rounding_sums_to_100_without_changing_raw_values(self):
        raw={'a':100/3,'b':100/3,'c':100/3}
        shown=display_percentages(raw)
        self.assertEqual(shown,{'a':33.4,'b':33.3,'c':33.3})
        self.assertAlmostEqual(sum(raw.values()),100)
        self.assertEqual(raw['a'],100/3)

if __name__=='__main__': unittest.main(verbosity=2)
