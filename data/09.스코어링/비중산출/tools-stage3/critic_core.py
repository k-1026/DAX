"""Read-only numerical primitives for the stage3 CRITIC pilot (stdlib only)."""
import math
import statistics


def quantile_linear(values, p):
    if not values or not 0 <= p <= 1:
        raise ValueError('Nonempty values and 0<=p<=1 required')
    values = sorted(values)
    if any(not math.isfinite(x) for x in values):
        raise ValueError('Nonfinite quantile input')
    position = (len(values)-1)*p
    lo, hi = math.floor(position), math.ceil(position)
    return values[lo]+(values[hi]-values[lo])*(position-lo)


def rent_burden(total, budget):
    if total is None:
        return None
    if not math.isfinite(total) or total < 0:
        raise ValueError('Invalid rent+management total')
    if budget is None:
        return None
    if not math.isfinite(budget) or budget <= 0:
        raise ValueError('Budget must be finite and positive')
    if total > budget:
        return None
    q = total/budget
    return 100.0 if q <= 0.5 else 160.0-120.0*q


def display_percentages(weights):
    if weights is None:
        return None
    keys = list(weights)
    vals = [weights[k] for k in keys]
    if not vals or any(not math.isfinite(v) or v < 0 for v in vals) or abs(sum(vals)-100)>1e-8:
        raise ValueError('Display input must be nonnegative percentages summing to 100')
    units = [math.floor(v*10+1e-10) for v in vals]
    order = sorted(range(len(vals)), key=lambda i: (-(vals[i]*10-units[i]), i))
    remainder = 1000-sum(units)
    if not 0 <= remainder <= len(vals):
        raise ValueError('Unexpected display remainder')
    for i in order[:remainder]:
        units[i] += 1
    return {k: units[i]/10 for i,k in enumerate(keys)}


def fit_critic(rows, factors, prior_weights, normalization='fixed_score', tolerance=1e-12):
    if not factors or len(set(factors)) != len(factors) or len(factors) != len(prior_weights):
        raise ValueError('Factor/prior shape mismatch')
    if normalization not in ('fixed_score','sample_minmax'):
        raise ValueError('Unknown normalization')
    if any(not math.isfinite(w) or w < 0 for w in prior_weights) or sum(prior_weights) <= 0:
        raise ValueError('Invalid prior weights')
    ids = [r['id'] for r in rows]
    if len(set(ids)) != len(ids):
        raise ValueError('Duplicate fitting IDs')
    for row in rows:
        for factor in factors:
            v = row.get(factor)
            if v is not None and (not isinstance(v,(int,float)) or not math.isfinite(v) or not 0<=v<=100):
                raise ValueError('Invalid score: '+str(row['id'])+'/'+factor)
    complete = [r for r in rows if all(r.get(f) is not None for f in factors)]
    prior = {f: 100*w/sum(prior_weights) for f,w in zip(factors,prior_weights)}
    result = dict(normalization=normalization, fittingInputN=len(rows), completeCaseN=len(complete),
                  completeCaseIds=[r['id'] for r in complete],
                  excludedByMissingnessN=len(rows)-len(complete),
                  missingPerFactor={f:sum(r.get(f) is None for r in rows) for f in factors},
                  factors=list(factors), originalWeights=prior,
                  equalWeights={f:100/len(factors) for f in factors},
                  candidateWeights=None, fallbackWeights=None, constantFactors=[],
                  nearConstantFactors=[], status=None, normalizedSD={}, correlation={}, information={}, scoreSummary={})
    if len(complete) < 2:
        result.update(status='cannot_estimate_insufficient_n', fallbackWeights=prior)
        return result
    columns = {f:[r[f] for r in complete] for f in factors}
    transformed = {}
    live = []
    for f, values in columns.items():
        lo,hi = min(values),max(values)
        result['scoreSummary'][f] = dict(n=len(values), min=lo, max=hi, mean=statistics.mean(values),
                                        median=statistics.median(values), unique=len(set(values)), sd=statistics.stdev(values))
        if hi == lo:
            result['constantFactors'].append(f)
            result['normalizedSD'][f] = 0.0
            continue
        transformed[f] = [v/100 if normalization=='fixed_score' else (v-lo)/(hi-lo) for v in values]
        sd = statistics.stdev(transformed[f])
        result['normalizedSD'][f] = sd
        if sd <= tolerance:
            result['nearConstantFactors'].append(f)
            continue
        live.append(f)
    result['informationFactors'] = live
    result['correlation'] = {f:{k:None for k in factors} for f in factors}
    result['information'] = {f:0.0 for f in factors}
    if not live:
        result.update(status='cannot_estimate_all_constant', fallbackWeights=prior)
        return result
    if len(live) == 1:
        result.update(status='single_factor',candidateWeights={f:100.0 if f==live[0] else 0.0 for f in factors})
        result['correlation'][live[0]][live[0]]=1.0
        return result
    means={f:statistics.mean(transformed[f]) for f in live}
    centered={f:[x-means[f] for x in transformed[f]] for f in live}
    squares={f:math.fsum(x*x for x in centered[f]) for f in live}
    for i,f in enumerate(live):
        for k in live[i:]:
            r = 1.0 if f==k else math.fsum(x*y for x,y in zip(centered[f],centered[k]))/math.sqrt(squares[f]*squares[k])
            if r > 1+tolerance or r < -1-tolerance:
                raise ValueError('Invalid numeric correlation')
            r = min(1.0,max(-1.0,r))
            result['correlation'][f][k] = result['correlation'][k][f] = r
    for f in live:
        result['information'][f] = result['normalizedSD'][f]*math.fsum(1-result['correlation'][f][k] for k in live)
    total = math.fsum(result['information'].values())
    result['totalInformation'] = total
    if total <= tolerance:
        result.update(status='cannot_estimate_zero_information', fallbackWeights=prior)
        return result
    result['candidateWeights'] = {f:100*result['information'][f]/total for f in factors}
    result['status'] = 'two_factor_sd_ratio' if len(live)==2 else 'estimated'
    return result
