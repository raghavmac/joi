'use strict';

const Net = require('net');

const Address = require('@hapi/address');
const Hoek = require('@hapi/hoek');

const Any = require('../any');
const Common = require('../../common');
const JoiDate = require('../date');

const Ip = require('./ip');
const Uri = require('./uri');


const internals = {
    base64Regex: {
        // paddingRequired
        true: {
            // urlSafe
            true: /^(?:[\w\-]{2}[\w\-]{2})*(?:[\w\-]{2}==|[\w\-]{3}=)?$/,
            false: /^(?:[A-Za-z0-9+\/]{2}[A-Za-z0-9+\/]{2})*(?:[A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)?$/
        },
        false: {
            true: /^(?:[\w\-]{2}[\w\-]{2})*(?:[\w\-]{2}(==)?|[\w\-]{3}=?)?$/,
            false: /^(?:[A-Za-z0-9+\/]{2}[A-Za-z0-9+\/]{2})*(?:[A-Za-z0-9+\/]{2}(==)?|[A-Za-z0-9+\/]{3}=?)?$/
        }
    },
    dataUriRegex: {
        format: /^data:[\w+.-]+\/[\w+.-]+;((charset=[\w-]+|base64),)?(.*)$/,
        base64: {
            // paddingRequired
            true: /^(?:[A-Za-z0-9+\/]{4})*(?:[A-Za-z0-9+\/]{2}==|[A-Za-z0-9+\/]{3}=)?$/,
            false: /^(?:[A-Za-z0-9+\/]{4})*(?:[A-Za-z0-9+\/]{2}(==)?|[A-Za-z0-9+\/]{3}=?)?$/
        }
    },
    hexRegex: /^[a-f0-9]+$/i,
    hostRegex: /^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$/,
    ipRegex: Ip.createIpRegex(['ipv4', 'ipv6', 'ipvfuture'], 'optional'),
    isoDurationRegex: /^P(?!$)(\d+Y)?(\d+M)?(\d+W)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+S)?)?$/,

    guidBrackets: {
        '{': '}', '[': ']', '(': ')', '': ''
    },
    guidVersions: {
        uuidv1: '1',
        uuidv2: '2',
        uuidv3: '3',
        uuidv4: '4',
        uuidv5: '5'
    },

    cidrPresences: ['required', 'optional', 'forbidden'],
    normalizationForms: ['NFC', 'NFD', 'NFKC', 'NFKD']
};


internals.String = class extends Any {

    constructor() {

        super();

        this._type = 'string';
        this._invalids.add('');
    }

    _coerce(value, state, options) {

        if (typeof value !== 'string') {
            return { value };
        }

        const normalize = this._uniqueRules.get('normalize');
        if (normalize) {
            value = value.normalize(normalize.args.form);
        }

        const casing = this._uniqueRules.get('case');
        if (casing) {
            value = casing.args.direction === 'upper' ? value.toLocaleUpperCase() : value.toLocaleLowerCase();
        }

        const trim = this._uniqueRules.get('trim');
        if (trim &&
            trim.args.enabled) {

            value = value.trim();
        }

        if (this._inner.replacements) {
            for (const replacement of this._inner.replacements) {
                value = value.replace(replacement.pattern, replacement.replacement);
            }
        }

        const hex = this._uniqueRules.get('hex');
        if (hex &&
            hex.args.options.byteAligned &&
            value.length % 2 !== 0) {

            value = `0${value}`;
        }

        if (this._uniqueRules.has('isoDate')) {
            let valid = false;
            if (JoiDate._isIsoDate(value)) {
                const date = new Date(value);
                if (!isNaN(date.getTime())) {
                    value = date.toISOString();
                    valid = true;
                }
            }

            if (!valid) {
                return { value, errors: this.createError('string.isoDate', { value }, state, options) };
            }
        }

        if (this._flags.truncate) {
            const rule = this._uniqueRules.get('max');
            if (rule) {
                value = value.slice(0, rule.args.limit);        // BUG - issue 1826
            }
        }

        return { value };
    }

    _base(value, state, options) {

        if (typeof value === 'string') {
            return { value, errors: null };
        }

        return { value, errors: this.createError('string.base', { value }, state, options) };
    }

    // Rules

    alphanum() {

        return this._rule('alphanum');
    }

    base64(options = {}) {

        Hoek.assert(typeof options === 'object', 'options must be an object');

        options = { urlSafe: false, paddingRequired: true, ...options };
        Hoek.assert(typeof options.paddingRequired === 'boolean', 'paddingRequired must be boolean');
        Hoek.assert(typeof options.urlSafe === 'boolean', 'urlSafe must be boolean');

        return this._rule('base64', { args: { options } });
    }

    creditCard() {

        return this._rule('creditCard');
    }

    dataUri(options = {}) {

        Hoek.assert(typeof options === 'object', 'options must be an object');

        options = { paddingRequired: true, ...options };
        Hoek.assert(typeof options.paddingRequired === 'boolean', 'paddingRequired must be boolean');

        return this._rule('dataUri', { args: { options } });
    }

    domain(options) {

        if (options) {
            Hoek.assert(typeof options === 'object', 'domain options must be an object');
            options = this._addressOptions(options);
        }

        return this._rule('domain', { args: { options } });
    }

    email(options) {

        if (options) {
            Hoek.assert(typeof options === 'object', 'email options must be an object');

            // Migration validation for unsupported options

            Hoek.assert(options.checkDNS === undefined, 'checkDNS option is not supported');
            Hoek.assert(options.errorLevel === undefined, 'errorLevel option is not supported');
            Hoek.assert(options.minDomainAtoms === undefined, 'minDomainAtoms option is not supported, use minDomainSegments instead');
            Hoek.assert(options.tldBlacklist === undefined, 'tldBlacklist option is not supported, use tlds.deny instead');
            Hoek.assert(options.tldWhitelist === undefined, 'tldWhitelist option is not supported, use tlds.allow instead');

            options = this._addressOptions(options);
        }

        return this._rule('email', { args: { options } });
    }

    guid(options = {}) {

        let versionNumbers = '';

        if (options.version) {
            const versions = [].concat(options.version);

            Hoek.assert(versions.length >= 1, 'version must have at least 1 valid version specified');
            const set = new Set();

            for (let i = 0; i < versions.length; ++i) {
                const version = versions[i];
                Hoek.assert(typeof version === 'string', 'version at position ' + i + ' must be a string');
                const versionNumber = internals.guidVersions[version.toLowerCase()];
                Hoek.assert(versionNumber, 'version at position ' + i + ' must be one of ' + Object.keys(internals.guidVersions).join(', '));
                Hoek.assert(!set.has(versionNumber), 'version at position ' + i + ' must not be a duplicate');

                versionNumbers += versionNumber;
                set.add(versionNumber);
            }
        }

        const regex = new RegExp(`^([\\[{\\(]?)[0-9A-F]{8}([:-]?)[0-9A-F]{4}\\2?[${versionNumbers || '0-9A-F'}][0-9A-F]{3}\\2?[${versionNumbers ? '89AB' : '0-9A-F'}][0-9A-F]{3}\\2?[0-9A-F]{12}([\\]}\\)]?)$`, 'i');

        return this._rule('guid', { args: { options }, regex });
    }

    hex(options = {}) {

        Common.assertOptions(options, ['byteAligned']);

        options = { byteAligned: false, ...options };
        Hoek.assert(typeof options.byteAligned === 'boolean', 'byteAligned must be boolean');

        return this._rule('hex', { args: { options } });
    }

    hostname() {

        return this._rule('hostname');
    }

    insensitive() {

        return this._flag('insensitive', true);
    }

    ip(options = {}) {

        let regex = internals.ipRegex;
        Hoek.assert(typeof options === 'object', 'options must be an object');
        options = Object.assign({}, options);       // Shallow cloned

        if (options.cidr) {
            Hoek.assert(typeof options.cidr === 'string', 'cidr must be a string');
            options.cidr = options.cidr.toLowerCase();

            Hoek.assert(Hoek.contain(internals.cidrPresences, options.cidr), 'cidr must be one of ' + internals.cidrPresences.join(', '));

            // If we only received a `cidr` setting, create a regex for it. But we don't need to create one if `cidr` is "optional" since that is the default

            if (!options.version &&
                options.cidr !== 'optional') {

                regex = Ip.createIpRegex(['ipv4', 'ipv6', 'ipvfuture'], options.cidr);
            }
        }
        else {
            options.cidr = 'optional';                // Set our default cidr strategy
        }

        let versions;
        if (options.version) {
            if (!Array.isArray(options.version)) {
                options.version = [options.version];
            }

            Hoek.assert(options.version.length >= 1, 'version must have at least 1 version specified');

            versions = [];
            for (let i = 0; i < options.version.length; ++i) {
                let version = options.version[i];
                Hoek.assert(typeof version === 'string', 'version at position ' + i + ' must be a string');
                version = version.toLowerCase();
                Hoek.assert(Ip.versions[version], 'version at position ' + i + ' must be one of ' + Object.keys(Ip.versions).join(', '));
                versions.push(version);
            }

            versions = Array.from(new Set(versions));   // Make sure we have a set of versions
            regex = Ip.createIpRegex(versions, options.cidr);
        }

        return this._rule('ip', { args: { options }, versions, regex });
    }

    isoDate() {

        return this._rule('isoDate', { convert: true });
    }

    isoDuration() {

        return this._rule('isoDuration');
    }

    length(limit, encoding) {

        return this._length('length', limit, '=', encoding);
    }

    lowercase() {

        return this._rule('case', { args: { direction: 'lower' }, convert: true });
    }

    max(limit, encoding) {

        return this._length('max', limit, '<=', encoding);
    }

    min(limit, encoding) {

        return this._length('min', limit, '>=', encoding);
    }

    normalize(form = 'NFC') {

        Hoek.assert(Hoek.contain(internals.normalizationForms, form), 'normalization form must be one of ' + internals.normalizationForms.join(', '));

        return this._rule('normalize', { args: { form }, convert: true });
    }

    regex(pattern, options) {

        Hoek.assert(pattern instanceof RegExp, 'pattern must be a RegExp');
        Hoek.assert(!pattern.flags.includes('g') && !pattern.flags.includes('y'), 'pattern should not use global or sticky mode');

        const patternObject = { pattern };

        if (typeof options === 'string') {
            patternObject.name = options;
        }
        else if (typeof options === 'object') {
            patternObject.invert = !!options.invert;

            if (options.name) {
                patternObject.name = options.name;
            }
        }

        const errorCode = ['string.regex', patternObject.invert ? '.invert' : '', patternObject.name ? '.name' : '.base'].join('');
        return this._rule('regex', { args: { patternObject }, errorCode, multi: true });
    }

    replace(pattern, replacement) {

        if (typeof pattern === 'string') {
            pattern = new RegExp(Hoek.escapeRegex(pattern), 'g');
        }

        Hoek.assert(pattern instanceof RegExp, 'pattern must be a RegExp');
        Hoek.assert(typeof replacement === 'string', 'replacement must be a String');

        // This can not be considere a test like trim, we can't "reject"
        // anything from this rule, so just clone the current object
        const obj = this.clone();

        if (!obj._inner.replacements) {
            obj._inner.replacements = [];
        }

        obj._inner.replacements.push({
            pattern,
            replacement
        });

        return obj;
    }

    token() {

        return this._rule('token');
    }

    trim(enabled = true) {

        Hoek.assert(typeof enabled === 'boolean', 'enabled must be a boolean');

        return this._rule('trim', { convert: true, args: { enabled } });
    }

    truncate(enabled = true) {

        Hoek.assert(typeof enabled === 'boolean', 'enabled must be a boolean');

        return this._flag('truncate', enabled);
    }

    uppercase() {

        return this._rule('case', { args: { direction: 'upper' }, convert: true });
    }

    uri(options = {}) {

        Hoek.assert(typeof options === 'object', 'options must be an object');

        const unknownOptions = Object.keys(options).filter((key) => !['scheme', 'allowRelative', 'relativeOnly', 'allowQuerySquareBrackets', 'domain'].includes(key));
        Hoek.assert(unknownOptions.length === 0, `options contain unknown keys: ${unknownOptions}`);

        if (options.domain) {
            options = Object.assign({}, options);                   // Shallow clone
            options.domain = this._addressOptions(options.domain);
        }

        const regex = Uri.createRegex(options);
        return this._rule('uri', { args: { options }, regex });
    }

    // Internals

    _addressOptions(options) {

        if (options.tlds &&
            typeof options.tlds === 'object') {

            Hoek.assert(options.tlds.allow === undefined ||
                options.tlds.allow === false ||
                options.tlds.allow === true ||
                Array.isArray(options.tlds.allow) ||
                options.tlds.allow instanceof Set, 'tlds.allow must be an array, Set, or boolean');

            Hoek.assert(options.tlds.deny === undefined ||
                Array.isArray(options.tlds.deny) ||
                options.tlds.deny instanceof Set, 'tlds.deny must be an array or Set');

            const normalizeTable = (table) => {

                if (table === undefined ||
                    typeof table === 'boolean' ||
                    table instanceof Set) {

                    return table;
                }

                return new Set(table);
            };

            options = Object.assign({}, options);       // Shallow cloned
            options.tlds = {
                allow: normalizeTable(options.tlds.allow),
                deny: normalizeTable(options.tlds.deny)
            };
        }

        Hoek.assert(options.minDomainSegments === undefined ||
            Number.isSafeInteger(options.minDomainSegments) && options.minDomainSegments > 0, 'minDomainSegments must be a positive integer');

        return options;
    }

    _length(name, limit, operator, encoding) {

        Hoek.assert(!encoding || Buffer.isEncoding(encoding), 'Invalid encoding:', encoding);

        const refs = {
            limit: {
                assert: (value) => Number.isSafeInteger(value) && value >= 0,
                code: 'string.ref',
                message: 'limit must be a positive integer or reference'
            }
        };

        return this._rule(name, { rule: 'length', refs, args: { limit, encoding }, operator });
    }
};


internals.String.prototype._rules = {

    alphanum: function (value, helpers) {

        if (/^[a-zA-Z0-9]+$/.test(value)) {
            return value;
        }

        return helpers.error('string.alphanum', { value });
    },

    base64: function (value, helpers, { options }) {

        const regex = internals.base64Regex[options.paddingRequired][options.urlSafe];
        if (regex.test(value)) {
            return value;
        }

        return helpers.error('string.base64', { value });
    },

    creditCard: function (value, helpers) {

        let i = value.length;
        let sum = 0;
        let mul = 1;

        while (i--) {
            const char = value.charAt(i) * mul;
            sum = sum + (char - (char > 9) * 9);
            mul = mul ^ 3;
        }

        if (sum > 0 &&
            sum % 10 === 0) {

            return value;
        }

        return helpers.error('string.creditCard', { value });
    },

    dataUri: function (value, helpers, { options }) {

        const matches = value.match(internals.dataUriRegex.format);

        if (matches) {
            if (!matches[2]) {
                return value;
            }

            if (matches[2] !== 'base64') {
                return value;
            }

            const base64regex = internals.dataUriRegex.base64[options.paddingRequired];
            if (base64regex.test(matches[3])) {
                return value;
            }
        }

        return helpers.error('string.dataUri', { value });
    },

    domain: function (value, helpers, { options }) {

        if (Address.domain.isValid(value, options)) {
            return value;
        }

        return helpers.error('string.domain', { value });
    },

    email: function (value, helpers, { options }) {

        if (Address.email.isValid(value, options)) {
            return value;
        }

        return helpers.error('string.email', { value });
    },

    guid: function (value, helpers, args, { regex }) {

        const results = regex.exec(value);

        if (!results) {
            return helpers.error('string.guid', { value });
        }

        // Matching braces

        if (internals.guidBrackets[results[1]] !== results[results.length - 1]) {
            return helpers.error('string.guid', { value });
        }

        return value;
    },

    hex: function (value, helpers, { options }) {

        if (!internals.hexRegex.test(value)) {
            return helpers.error('string.hex', { value });
        }

        if (options.byteAligned &&
            value.length % 2 !== 0) {

            return helpers.error('string.hexAlign', { value });
        }

        return value;
    },

    hostname: function (value, helpers) {

        if (value.length <= 255 && internals.hostRegex.test(value) ||
            Net.isIPv6(value)) {

            return value;
        }

        return helpers.error('string.hostname', { value });
    },

    ip: function (value, helpers, { options }, { versions, regex }) {

        if (regex.test(value)) {
            return value;
        }

        if (versions) {
            return helpers.error('string.ipVersion', { value, cidr: options.cidr, version: versions });
        }

        return helpers.error('string.ip', { value, cidr: options.cidr });
    },

    isoDate: function (value, { error, options }) {

        if (JoiDate._isIsoDate(value)) {
            return value;
        }

        return error('string.isoDate', { value });
    },

    isoDuration: function (value, helpers) {

        if (internals.isoDurationRegex.test(value)) {
            return value;
        }

        return helpers.error('string.isoDuration', { value });
    },

    length: function (value, helpers, { limit, encoding }, { alias, operator, args }) {

        const length = encoding ? Buffer.byteLength(value, encoding) : value.length;
        if (Common.compare(length, limit, operator)) {
            return value;
        }

        return helpers.error('string.' + alias, { limit: args.limit, value, encoding });
    },

    case: function (value, helpers, { direction }) {

        if (direction === 'lower' && value === value.toLocaleLowerCase() ||
            direction === 'upper' && value === value.toLocaleUpperCase()) {

            return value;
        }

        return helpers.error(`string.${direction}case`, { value });
    },

    normalize: function (value, { error, options }, { form }) {

        if (value === value.normalize(form)) {
            return value;
        }

        return error('string.normalize', { value, form });
    },

    regex: function (value, helpers, { patternObject }, { errorCode }) {

        const patternMatch = patternObject.pattern.test(value);

        if (patternMatch ^ patternObject.invert) {
            return value;
        }

        return helpers.error(errorCode, { name: patternObject.name, pattern: patternObject.pattern, value });
    },

    token: function (value, helpers) {

        if (/^\w+$/.test(value)) {
            return value;
        }

        return helpers.error('string.token', { value });
    },

    trim: function (value, helpers, { enabled }) {

        if (!enabled ||
            value === value.trim()) {

            return value;
        }

        return helpers.error('string.trim', { value });
    },

    uri: function (value, helpers, { options }, { regex }) {

        const match = regex.exec(value);
        if (match) {
            if (options.domain &&
                !Address.domain.isValid(match[1], options.domain)) {

                return helpers.error('string.domain', { value: match[1] });
            }

            return value;
        }

        if (options.relativeOnly) {
            return helpers.error('string.uriRelativeOnly', { value });
        }

        if (options.scheme) {
            return helpers.error('string.uriCustomScheme', { scheme: regex.scheme, value });
        }

        return helpers.error('string.uri', { value });
    }
};


// Aliases

internals.String.prototype.uuid = internals.String.prototype.guid;


module.exports = new internals.String();
