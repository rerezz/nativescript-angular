import 'globals';
import "zone.js/dist/zone-node";

import 'reflect-metadata';
import './polyfills/array';
import './polyfills/console';

import {rendererLog, rendererError} from "./trace";
import {SanitizationService} from '@angular/core/src/security';
import {isPresent, Type, print} from '@angular/core/src/facade/lang';
import {ReflectiveInjector, coreLoadAndBootstrap, createPlatform, EventEmitter,
    getPlatform, assertPlatform, ComponentRef, PlatformRef, PLATFORM_DIRECTIVES, PLATFORM_PIPES} from '@angular/core';
import {bind, provide, Provider} from '@angular/core/src/di';

import {RootRenderer, Renderer} from '@angular/core/src/render/api';
import {NativeScriptRootRenderer, NativeScriptRenderer} from './renderer';
import {NativeScriptDomAdapter, NativeScriptElementSchemaRegistry, NativeScriptSanitizationService} from './dom-adapter';
import {ElementSchemaRegistry, XHR, COMPILER_PROVIDERS, CompilerConfig} from '@angular/compiler';
import {Http, XHRBackend, BrowserXhr, RequestOptions, ResponseOptions, XSRFStrategy} from '@angular/http';
import {FileSystemXHR} from './http/xhr';
import {NSXSRFStrategy, NSHttp} from './http/ns-http';
import {NSFileSystem} from './file-system/ns-file-system';
import {Parse5DomAdapter} from '@angular/platform-server/src/parse5_adapter';
import {ExceptionHandler} from '@angular/core/src/facade/exception_handler';
import {APPLICATION_COMMON_PROVIDERS} from '@angular/core/src/application_common_providers';
import {PLATFORM_COMMON_PROVIDERS} from '@angular/core/src/platform_common_providers';
import {COMMON_DIRECTIVES, COMMON_PIPES, FORM_PROVIDERS} from "@angular/common";
import {NS_DIRECTIVES} from './directives';

import {Page} from 'ui/page';
import {TextView} from 'ui/text-view';
import application = require('application');
import {topmost, NavigationEntry} from "ui/frame";
import {Observable} from "rxjs";

export type ProviderArray = Array<Type | Provider | any[]>;

import {defaultPageProvider, defaultDeviceProvider} from "./platform-providers";

import * as nativescriptIntl from "nativescript-intl";
global.Intl = nativescriptIntl;

export interface AppOptions {
    cssFile?: string;
    startPageActionBarHidden?: boolean;
}

class ConsoleLogger {
    log = print;
    logError = print;
    logGroup = print;
    logGroupEnd() { }
}

interface BootstrapParams {
    appComponentType: Type,
    customProviders?: ProviderArray,
    appOptions?: AppOptions
}
var bootstrapCache: BootstrapParams

var lastBootstrappedApp: WeakRef<ComponentRef<any>>;
export const onBeforeLivesync = new EventEmitter<ComponentRef<any>>();
export const onAfterLivesync = new EventEmitter<ComponentRef<any>>();

// See: https://github.com/angular/angular/commit/1745366530266d298306b995ecd23dabd8569e28
export const NS_COMPILER_PROVIDERS: ProviderArray = [
    COMPILER_PROVIDERS,
    provide(CompilerConfig, {
        useFactory: (platformDirectives: any[], platformPipes: any[]) => {
            return new CompilerConfig({ platformDirectives, platformPipes });
        },
        deps: [PLATFORM_DIRECTIVES, PLATFORM_PIPES]
    }),
    provide(XHR, { useClass: FileSystemXHR }),
    provide(PLATFORM_PIPES, { useValue: COMMON_PIPES, multi: true }),
    provide(PLATFORM_DIRECTIVES, { useValue: COMMON_DIRECTIVES, multi: true }),
    provide(PLATFORM_DIRECTIVES, { useValue: NS_DIRECTIVES, multi: true })
];

export function bootstrap(appComponentType: any,
    customProviders: ProviderArray = null): Promise<ComponentRef<any>> {
    NativeScriptDomAdapter.makeCurrent();

    let platformProviders: ProviderArray = [
        PLATFORM_COMMON_PROVIDERS,
    ];

    let defaultAppProviders: ProviderArray = [
        APPLICATION_COMMON_PROVIDERS,
        FORM_PROVIDERS,
        provide(ExceptionHandler, {
            useFactory: () => {
                return new ExceptionHandler(new ConsoleLogger(), true)
            }, deps: []
        }),

        defaultPageProvider,
        defaultDeviceProvider,
        NativeScriptRootRenderer,
        provide(RootRenderer, { useClass: NativeScriptRootRenderer }),
        NativeScriptRenderer,
        provide(Renderer, { useClass: NativeScriptRenderer }),
        provide(SanitizationService, { useClass: NativeScriptSanitizationService }),
        provide(ElementSchemaRegistry, { useClass: NativeScriptElementSchemaRegistry }),
        NS_COMPILER_PROVIDERS,
        provide(ElementSchemaRegistry, { useClass: NativeScriptElementSchemaRegistry }),
        provide(XHR, { useClass: FileSystemXHR })
    ]

    var appProviders = [defaultAppProviders];
    if (isPresent(customProviders)) {
        appProviders.push(customProviders);
    }

    // Http Setup    
    // Since HTTP_PROVIDERS can be added with customProviders above, this must come after
    appProviders.push([
        provide(XSRFStrategy, { useValue: new NSXSRFStrategy() }),
        NSFileSystem,
        provide(Http, {
            useFactory: (backend, options, nsFileSystem) => {
                return new NSHttp(backend, options, nsFileSystem);
            }, deps: [XHRBackend, RequestOptions, NSFileSystem]
        })
    ]);

    var platform = getPlatform();
    if (!isPresent(platform)) {
        platform = createPlatform(ReflectiveInjector.resolveAndCreate(platformProviders));
    }

    // reflector.reflectionCapabilities = new ReflectionCapabilities();
    var appInjector = ReflectiveInjector.resolveAndCreate(appProviders, platform.injector);
    return coreLoadAndBootstrap(appComponentType, appInjector);
}

function createNavigationEntry(params: BootstrapParams, resolve: (comp: ComponentRef<any>) => void, reject: (e: Error) => void, isReboot: boolean) {
    const navEntry: NavigationEntry = {
        create: (): Page => {
            let page = new Page();
            if (params.appOptions) {
                page.actionBarHidden = params.appOptions.startPageActionBarHidden;
            }

            let onLoadedHandler = function (args) {
                page.off('loaded', onLoadedHandler);
                //profiling.stop('application-start');
                rendererLog('Page loaded');

                //profiling.start('ng-bootstrap');
                rendererLog('BOOTSTRAPPING...');
                bootstrap(params.appComponentType, params.customProviders).then((compRef) => {
                    //profiling.stop('ng-bootstrap');
                    rendererLog('ANGULAR BOOTSTRAP DONE.');
                    lastBootstrappedApp = new WeakRef(compRef);
                    resolve(compRef);
                }, (err) => {
                    rendererError('ERROR BOOTSTRAPPING ANGULAR');
                    let errorMessage = err.message + "\n\n" + err.stack;
                    rendererError(errorMessage);

                    let view = new TextView();
                    view.text = errorMessage;
                    page.content = view;
                    reject(err);
                });
            }

            page.on('loaded', onLoadedHandler);

            return page;
        }
    };

    if (isReboot) {
        navEntry.animated = false;
        navEntry.clearHistory = true;
    }

    return navEntry;
}

export function nativeScriptBootstrap(appComponentType: any, customProviders?: ProviderArray, appOptions?: AppOptions): Promise<ComponentRef<any>> {
    bootstrapCache = { appComponentType, customProviders, appOptions };

    if (appOptions && appOptions.cssFile) {
        application.cssFile = appOptions.cssFile;
    }

    return new Promise((resolve, reject) => {
        const navEntry = createNavigationEntry(bootstrapCache, resolve, reject, false);
        application.start(navEntry);
    })
}

// Patch livesync
const _baseLiveSync = global.__onLiveSync;
global.__onLiveSync = function () {
    rendererLog("LiveSync Started")
    if (bootstrapCache) {
        onBeforeLivesync.next(lastBootstrappedApp ? lastBootstrappedApp.get() : null);

        const frame = topmost();
        const newEntry = createNavigationEntry(
            bootstrapCache,
            compRef => onAfterLivesync.next(compRef),
            error => onAfterLivesync.error(error),
            true);

        if (frame) {
            if (frame.currentPage && frame.currentPage.modal) {
                frame.currentPage.modal.closeModal();
            }
            frame.navigate(newEntry);
        }
    }
    else {
        _baseLiveSync();
    }
}


