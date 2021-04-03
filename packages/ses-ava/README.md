# ses-ava

*SES-Ava* can wrap Ava `test` functions such that errors are reported to the
console in full detail.
This compensates for how SES, with full error taming, only reveals stack traces
to debugging tools.

To use this module, create an Ava module wrapper in your target project.

```js
import { test as avaTest } from 'ava';
import { wrapTest } from 'ses-ava';

export const test = wrapTest(avaTest);
```

Then, import your test wrapper instead of Ava in your tests.

SES-Ava rhymes with Nineveh.