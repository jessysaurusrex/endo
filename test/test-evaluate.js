import { test } from 'tape-promise/tape';
import { evaluateExpr, evaluateProgram, makeEvaluators } from '../src/index';

test('leakage', t => {
  try {
    t.throws(() => evaluateExpr('scopedEval'), ReferenceError, 'do not leak');
    t.throws(
      () => evaluateExpr('makeEvaluator'),
      ReferenceError,
      'do not leak',
    );
    t.equal(evaluateExpr('this'), undefined, 'do not leak this');
    t.equal(
      evaluateExpr('function() { return this; }')(),
      undefined,
      'do not leak nested this',
    );
  } catch (e) {
    t.assert(false, e);
  } finally {
    t.end();
  }
});

test('basic', t => {
  try {
    t.equal(evaluateExpr('1+2'), 3, 'addition');
    t.equal(evaluateExpr('(a,b) => a+b')(1, 2), 3, 'arrow expr');
    t.equal(
      evaluateExpr('function(a,b) { return a+b; }')(1, 2),
      3,
      'function expr',
    );
    t.throws(
      () => evaluateExpr('123; 234'),
      SyntaxError,
      'evaluateExpr fails program',
    );
    t.equal(evaluateProgram('123; 234'), 234, 'evaluateProgram succeeds');
    t.equal(evaluateExpr(`(1,eval)('123')`), 123, 'indirect eval succeeds');
  } catch (e) {
    t.assert(false, e);
  } finally {
    t.end();
  }
});

test('endowments', t => {
  try {
    t.equal(evaluateExpr('1+a', { a: 2 }), 3, 'endowment addition');
    t.equal(
      evaluateExpr('(a,b) => a+b+c', { c: 3 })(1, 2),
      6,
      'endowment arrow expr',
    );
    t.equal(
      evaluateExpr('function(a,b) { return a+b+c; }', { c: 3 })(1, 2),
      6,
      'endowment function expr',
    );
    t.equal(evaluateExpr('1+a+b', { a: 2, b: 3 }), 6, 'multiple endowments');
  } catch (e) {
    t.assert(false, e);
  } finally {
    t.end();
  }
});

test('options.transforms', t => {
  try {
    const endowments = Object.create(null, {
      foo: { value: 1 },
      bar: { value: 2, writable: true },
    });

    const evalTransforms = [
      {
        endow(es) {
          return { ...es, endowments: { ...es.endowments, abc: 123 } };
        },
        rewrite(ss) {
          const src =
            (ss.src === 'ABC' ? 'abc' : ss.src) + (ss.isExpr ? '' : ';');
          return { ...ss, src };
        },
      },
    ];

    const options = {
      transforms: [
        {
          rewrite(ss) {
            return { ...ss, src: ss.src === 'ABC' ? 'def' : ss.src };
          },
        },
      ],
    };

    const { evaluateExpr: myExpr, evaluateProgram: myProg } = makeEvaluators({
      endowments,
      transforms: evalTransforms,
    });

    t.equal(
      myProg('234; abc', {}),
      123,
      `evalTransforms don't rewrite program`,
    );
    t.equal(myProg('ABC', {}), 123, `evalTransforms rewrite program`);
    t.equal(myExpr('abc', {}), 123, `evalTransforms don't rewrite`);
    t.equal(myExpr('ABC', { ABC: 234 }), 123, `evalTransforms rewrite ABC`);
    t.equal(
      myExpr('ABC', { ABC: 234, abc: 'notused' }),
      123,
      `endowments.abc is overridden`,
    );
    t.equal(
      myExpr('ABC', { def: 789 }, options),
      789,
      `options.transforms go first`,
    );
  } catch (e) {
    t.assert(false, e);
  } finally {
    t.end();
  }
});