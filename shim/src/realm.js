import { createContextRec, getCurrentContextRec } from './context';
import { getSafeEvaluator, getFunctionEvaluator } from './evaluators';
import { getStdLib } from './stdlib';
import { getIntrinsics } from './intrinsics';
import { assign, create, defineProperty, defineProperties, getPrototypeOf } from './commons';
import { Intrinsics, GlobalObject, SafeEvaluator, ContextRec } from './symbols';

const Realm2RealmRec = new WeakMap();
const RealmProto2ContextRec = new WeakMap();

// buildChildRealm is immediately turned into a string, and this function is
// never referenced again, because it closes over the wrong intrinsics

function buildChildRealm(BaseRealm) {
  const errorConstructors = new Map([
    ['EvalError', EvalError],
    ['RangeError', RangeError],
    ['ReferenceError', ReferenceError],
    ['SyntaxError', SyntaxError],
    ['TypeError', TypeError],
    ['URIError', URIError]
  ]);

  // Like Realm.apply except that it catches anything thrown and rethrows it
  // as an Error from this realm
  function doAndWrapError(thunk) {
    try {
      return thunk();
    } catch (err) {
      if (Object(err) !== err) {
        throw err;
      }
      let eName, eMessage;
      try {
        // The child environment might seek to use 'err' to reach the
        // parent's intrinsics and corrupt them. `${err.name}` will cause
        // string coercion of 'err.name'. If err.name is an object (probably
        // a String of the parent Realm), the coercion uses
        // err.name.toString(), which is under the control of the parent. If
        // err.name were a primitive (e.g. a number), it would use
        // Number.toString(err.name), using the child's version of Number
        // (which the child could modify to capture its argument for later
        // use), however primitives don't have properties like .prototype so
        // they aren't useful for an attack.
        eName = `${err.name}`;
        eMessage = `${err.message}`;
        // eName and eMessage are now child-realm primitive strings, and safe
        // to expose
      } catch (_) {
        // if err.name.toString() throws, keep the (parent realm) Error away
        // from the child
        throw new Error('Something bad happened');
      }
      const ErrorConstructor = errorConstructors.get(eName) || Error;
      throw new ErrorConstructor(eMessage);
    }
  }

  const descs = Object.getOwnPropertyDescriptors(BaseRealm.prototype);

  class Realm {
    constructor(...args) {
      return doAndWrapError(() => Reflect.construct(BaseRealm, args, Realm));
    }
    get intrinsics() {
      return doAndWrapError(() => descs.intrinsics.get.apply(this));
    }
    get global() {
      return doAndWrapError(() => descs.global.get.apply(this));
    }
    evaluate(...args) {
      return doAndWrapError(() => descs.evaluate.value.apply(this, args));
    }
    static makeRootRealm() {
      return new Realm();
    }
    static makeCompartment() {
      return new Realm({
        transform: 'inherit',
        isDirectEval: 'inherit',
        intrinsics: 'inherit'
      });
    }
  }

  Object.defineProperty(Realm.prototype, Symbol.toStringTag, {
    value: 'function Realm() { [shim code] }',
    writable: false,
    enumerable: false,
    configurable: true
  });

  return Realm;
}

const buildChildRealmString = `(${buildChildRealm})`;

function createRealmFacade(contextRec, BaseRealm) {
  const { contextEval, contextGlobal } = contextRec;

  // The BaseRealm is the Realm class created by
  // the shim. It's only valid for the context where
  // it was parsed.

  // The Realm facade is a lightwwight class built in the
  // context a different context, that provide a fully
  // functional Realm class using the intrisics
  // of that context.

  // This process is simplified becuase all methods
  // and properties on a realm instance already return
  // values using the intrinsics of the realm's context.

  // Invoke the BaseRealm constructor with Realm as the prototype.
  const Realm = contextEval(buildChildRealmString)(BaseRealm);
  contextGlobal.Realm = Realm;
  RealmProto2ContextRec.set(Realm.prototype, contextRec);
}

function getGlobaObject(intrinsics) {
  return create(intrinsics.ObjectPrototype);
}

function createEvaluators(realmRec) {
  // Divergence from specifications: the evaluators are tied to
  // a global and they are tied to a realm and to the intrinsics
  // of that realm.
  const safeEvaluator = getSafeEvaluator(realmRec);
  const functionEvaluator = getFunctionEvaluator(realmRec);

  // Limitation: export a direct evaluator.
  const intrinsics = realmRec[Intrinsics];
  intrinsics.eval = safeEvaluator;
  intrinsics.Function = functionEvaluator;

  realmRec[SafeEvaluator] = safeEvaluator;
}

function setDefaultBindings(realmRec) {
  const intrinsics = realmRec[Intrinsics];
  const descs = getStdLib(intrinsics);
  defineProperties(realmRec[GlobalObject], descs);
}

export default class Realm {
  constructor(options) {
    const O = this;
    options = Object(options); // Todo: sanitize

    if (options.thisValue !== undefined) {
      throw new TypeError('Realm only supports undefined thisValue.');
    }

    let contextRec;
    if (
      options.intrinsics === 'inherit' &&
      options.isDirectEval === 'inherit' &&
      options.transform === 'inherit'
    ) {
      // In "inherit" mode, we create a compartment realm and inherit
      // the context since we share the intrinsics. We create a new
      // set to allow us to define eval() and Function() for the realm.

      // Class constructor only has a [[Construct]] behavior and not
      // a call behavior, therefore the use of "this" cannot be bound
      // by an adversary.
      contextRec = RealmProto2ContextRec.get(getPrototypeOf(this));
    } else if (
      options.intrinsics === undefined &&
      options.isDirectEval === undefined &&
      options.transform === undefined
    ) {
      // When intrinics are not provided, we create a root realm
      // using the fresh set of new intrinics from a new context.
      contextRec = createContextRec();
      createRealmFacade(contextRec, Realm);
    } else {
      // todo: this leaks the parent TypeError, from which the child can
      // access .prototype and the parent's intrinsics
      throw new TypeError('Realm only supports undefined or "inherited" intrinsics.');
    }
    const intrinsics = getIntrinsics(contextRec);
    const globalObj = getGlobaObject(intrinsics);

    const realmRec = {
      [ContextRec]: contextRec,
      [Intrinsics]: intrinsics,
      [GlobalObject]: globalObj,
      [SafeEvaluator]: undefined
    };
    Realm2RealmRec.set(O, realmRec);

    createEvaluators(realmRec);
    setDefaultBindings(realmRec);
  }
  get intrinsics() {
    const O = this;
    if (typeof O !== 'object') throw new TypeError();
    if (!Realm2RealmRec.has(O)) throw new TypeError();
    const realmRec = Realm2RealmRec.get(O);
    const intrinsics = realmRec[Intrinsics];
    // The object returned has its prototype
    // match the ObjectPrototype of the realm.
    const obj = create(intrinsics.ObjectPrototype);
    return assign(obj, intrinsics);
  }
  get global() {
    const O = this;
    if (typeof O !== 'object') throw new TypeError();
    if (!Realm2RealmRec.has(O)) throw new TypeError();
    const realmRec = Realm2RealmRec.get(O);
    return realmRec[GlobalObject];
  }
  evaluate(x) {
    const O = this;
    if (typeof O !== 'object') throw new TypeError();
    if (!Realm2RealmRec.has(O)) throw new TypeError();
    const realmRec = Realm2RealmRec.get(O);
    const evaluator = realmRec[SafeEvaluator];
    return evaluator(`${x}`);
  }
  static makeRootRealm() {
    return new Realm();
  }
  static makeCompartment() {
    return new Realm({
      transform: 'inherit',
      isDirectEval: 'inherit',
      intrinsics: 'inherit'
    });
  }
}

RealmProto2ContextRec.set(Realm.prototype, getCurrentContextRec());

defineProperty(Realm.prototype, Symbol.toStringTag, {
  value: 'function Realm() { [shim code] }',
  writable: false,
  enumerable: false,
  configurable: true
});