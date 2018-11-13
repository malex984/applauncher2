import EventEmitter from 'events';
import superagent from 'superagent';
import Ajv from 'ajv';
import yaml from 'js-yaml';
import BrowserHelper from './helpers/browser-helper';
import cfgSchema from './schemas/cfg.schema.json';
import appCfgSchema from './schemas/appcfg.schema.json';

/**
 * Loader of config files used to initialize AppLauncher
 */
export default class AppLauncherLoader {
  constructor() {
    this.events = new EventEmitter();
    this.progress = 0;
    this.progressStep = 0.25;

    this.qs = BrowserHelper.getQueryString();

    this.ajv = new Ajv();
    this.validateCfg = this.ajv.compile(cfgSchema);
    this.validateAppCfg = this.ajv.compile(appCfgSchema);
  }

  /**
   * Runs the loading routine and returns the config through a Promise
   *
   * The main appLauncher config is loaded together with all the app configurations
   * (app.json files).
   * The app configurations are placed in the appCfgs property of the main config as an object
   * indexed by the apps's root directory.
   *
   * @return {Promise<object>}
   */
  run() {
    return this.loadCfg()
      .then(cfg => this.loadAllAppCfgs(cfg)
          .then(appCfgs => Object.assign({}, cfg, { appCfgs })))
      .catch((e) => {
        console.error(e);
        throw e;
      });
  }

  incrementProgress() {
    this.progress += this.progressStep;
    if (this.progress > 1) {
      this.progress = 1;
    }
    this.events.emit('progress', this.progress);
  }

  /**
   * Loads and returns the main appLauncher config.
   *
   * Which configuration is loaded depends on the query string parameter (see getCfgPrefix())
   *
   * @return {Promise<object>}
   */
  loadCfg() {
    const cfgFile = `cfg/${this.getCfgPrefix()}config.yml`;
    return superagent.get(`${cfgFile}?cache=${Date.now()}`)
      .then(response => yaml.safeLoad(response.text))
      .catch((e) => {
        throw new Error(`Error parsing ${cfgFile}: ${e.message}`);
      })
      .then((cfg) => {
        if (!this.validateCfg(cfg)) {
          throw new Error(`Error in ${cfgFile}: ${this.ajv.errorsText(this.validateCfg.errors)}`);
        }
        this.incrementProgress();
        return cfg;
      })
      .then(cfg => Object.assign({}, cfg, this.getQSOverrides()));
  }

  /**
   * Gets any configuration properties overriden through the query string
   *
   * @return {Object}
   */
  getQSOverrides() {
    const overrides = {};
    if (this.qs.lang && AppLauncherLoader.validLangQS.test(this.qs.lang)) {
      overrides.lang = this.qs.lang;
    }

    return overrides;
  }

  /**
   * Gets the configuration file prefix to load as specified through the query string
   *
   * @return {string}
   */
  getCfgPrefix() {
    return this.qs.cfg && AppLauncherLoader.validCfgPrefix.test(this.qs.cfg) ? `${this.qs.cfg}.` : '';
  }

  /**
   * Loads all app cfgs (app.json files) specified in the main config
   *
   * @param {Object} cfg
   *  The main appLauncher config
   * @return {Promise<Object>}
   */
  loadAllAppCfgs(cfg) {
    const allCfgs = {};

    const apps = cfg.apps.concat(cfg.infoApp ? cfg.infoApp : []);

    this.progressStep = (1 - this.progress) / apps.length;
    return Promise.map(apps, appRoot => this.loadAppCfg(appRoot)
      .then((appCfg) => {
        allCfgs[appRoot] = appCfg;
        this.incrementProgress();
      })
    ).then(() => allCfgs);
  }

  /**
   * Loads an individual app cfg
   *
   * @param {String} appRoot
   *  The application's root directory, where the app.json file will be found
   * @return {Promise<Object>}
   */
  loadAppCfg(appRoot) {
    return superagent.get(`${appRoot}/app.json?cache=${Date.now()}`)
      .set('Accept', 'json')
      .then(({ body }) => {
        if (!this.validateAppCfg(body)) {
          throw new Error(`Error in ${appRoot}/app.json: ${this.ajv.errorsText(this.validateAppCfg.errors)}`);
        }
        return body;
      })
      .then(cfg => Object.assign({ type: 'iframe' }, cfg, { root: appRoot }));
  }
}

// Valid configuration file prefixes
AppLauncherLoader.validCfgPrefix = /^[a-zA-Z0-9_\-.]+$/;
// Valid ISO language codes
AppLauncherLoader.validLangQS = /^[a-zA-Z]{2}(-[a-zA-Z]{2})?$/;
