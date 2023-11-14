// This module builds on Obsidians cache to provide more specific link information

import { CachedMetadata, HeadingCache, stripHeading, TFile, Pos, parseLinktext, CacheItem} from "obsidian";
import SNWPlugin from "./main";
import {Link, TransformedCache} from "./types";

let references: {[x:string]:Link[]};
let allLinkResolutions: Link[];
let lastUpdateToReferences = 0;
let thePlugin: SNWPlugin;

export function setPluginVariableForIndexer(plugin: SNWPlugin) {
    thePlugin = plugin;
}

export function getReferencesCache() {
    return references;
}

export function getSnwAllLinksResolutions(){
    return allLinkResolutions;
}

interface LinkResolutionCache {
    reference: {
        displayText: string,
        link: string,
        position: CacheItem['position']
    },
    resolvedFile: TFile | null,
    ghostLink: string,
    realLink: string,
    sourceFile: TFile,
    excludedFile: boolean
}

// compare ctime, mtime, size to see if any changes
interface GlobalRefsCacheMapSrcFile {
    srcFilePathString: string;
    srcFile: TFile;
    srcFileStats: {
        ctime: number,
        mtime: number,
        size: number
    }
    srcFileIgnored: boolean;
    linkReferenceCache: LinkResolutionCache[]
}
interface GlobalRefsCacheLinkLookup {
    resolvedFilePath: ReturnType<typeof parseLinktext>,
    resolvedTFile?: TFile,
    fileLink?: string,
    fileLinkIgnored?: boolean,
    ghlink?: string
}
const globalRefsCache = {
    globalRefsCacheMap: new Map<string, GlobalRefsCacheMapSrcFile>(),
    refLinkResolutionCache: new Map<string, GlobalRefsCacheLinkLookup>()
}

/**
 * Buildings a optimized list of cache references for resolving the block count. 
 * It is only updated when there are data changes to the vault. This is hooked to an event
 * trigger in main.ts
 * @export
 */
export function buildLinksAndReferences(type: 'full' | 'partial' = 'partial'): void {
    if(thePlugin.showCountsActive!=true) return;
    console.time('SNW: buildLinksAndReferences');
    
    if(type==='full') {
        console.log("SNW: buildLinksAndReferences > FULL REBUILD of Index");
        references = {};
        allLinkResolutions = [];
        globalRefsCache.globalRefsCacheMap = new Map<string, GlobalRefsCacheMapSrcFile>();
        globalRefsCache.refLinkResolutionCache = new Map<string, GlobalRefsCacheLinkLookup>();
    }
    const indexOptimizationStats = {
        totalFiles: 0,
        totalFilesIgnored: 0,
        totalLinksIgnored: 0,
        totalLinks: 0,
        skippedFilesNoChanges: 0,
        skippedFoundLinks: 0,
        refsLinkLookup: 0,
        finalLinksResolution: 0,
        allLinksResolution: 0,
        updateIndexNeededFalse: 0
    }
    allLinkResolutions = [];
    // let ctr = 0;
    // const buildListOfSkippedFilesNoChanges: string[] = [];
    // const buildListOfIteratedFiles: {
    //     srcFilePathString: string,

    // }[] = [];
    const buildMapOfIteratedFiles = new Map<string, {
        srcFilePathString: string,
        updateIndexNeeded: boolean,
        globalRefsCacheSrcFound?: GlobalRefsCacheMapSrcFile,
        linkReferenceCache: LinkResolutionCache[]
    }>();

    console.time('SNW: buildLinksAndReferences > app.metadataCache.iterateReferences');
    thePlugin.app.metadataCache.iterateReferences((src, refs) => {
        indexOptimizationStats.totalLinks++;
        // first idea: store files and their links as a map and see if anything changed, otherwise skip

        // ctr++;
        // if (ctr > 1_000) return;

        let globalRefsCacheToUse: GlobalRefsCacheMapSrcFile | undefined;
        let buildMapOfIteratedFilesToUse: ReturnType<typeof buildMapOfIteratedFiles.get>;
        const buildMapOfIteratedFilesFound = buildMapOfIteratedFiles.get(src);
        if (buildMapOfIteratedFilesFound) {
            if (buildMapOfIteratedFilesFound.updateIndexNeeded === false) {
                // console.log(
                //     "SNW: buildLinksAndReferences > updateIndexNeeded === false",
                //     src
                // );
                indexOptimizationStats.updateIndexNeededFalse++;
                return;
            }
            buildMapOfIteratedFilesToUse = buildMapOfIteratedFilesFound;
            globalRefsCacheToUse = buildMapOfIteratedFilesFound.globalRefsCacheSrcFound;
        } else {
            let skipNote: boolean = false;
            const globalRefsCacheSrcFound = globalRefsCache.globalRefsCacheMap.get(src);
            if (globalRefsCacheSrcFound) {
                globalRefsCacheToUse = globalRefsCacheSrcFound;
                if (
                    globalRefsCacheSrcFound.srcFileStats.ctime ===
                        globalRefsCacheSrcFound.srcFile.stat.ctime &&
                    globalRefsCacheSrcFound.srcFileStats.mtime ===
                        globalRefsCacheSrcFound.srcFile.stat.mtime &&
                    globalRefsCacheSrcFound.srcFileStats.size ===
                        globalRefsCacheSrcFound.srcFile.stat.size
                ) {
                    skipNote = true;
                    indexOptimizationStats.skippedFilesNoChanges++;
                }
            } else {
                const foundTFile = thePlugin.app.vault.getAbstractFileByPath(src);
                if (foundTFile && foundTFile instanceof TFile) {
                    globalRefsCache.globalRefsCacheMap.set(src, {
                        srcFilePathString: src,
                        srcFile: foundTFile,
                        srcFileStats: {
                            ctime: foundTFile.stat.ctime,
                            mtime: foundTFile.stat.mtime,
                            size: foundTFile.stat.size,
                        },
                        srcFileIgnored: thePlugin.app.metadataCache.isUserIgnored(
                            foundTFile.path
                        ),
                        linkReferenceCache: [],
                    });
                    globalRefsCacheToUse = globalRefsCache.globalRefsCacheMap.get(src);
                } else {
                    // this ELSE should never be reached, but using for type narrowing above to TFile instead of TFolder
                    console.log(
                        "SNW: buildLinksAndReferences > foundTFile > NOT FOUND > This should NOT actually happen!"
                    );
                }
            }

            buildMapOfIteratedFilesToUse = {
                srcFilePathString: src,
                updateIndexNeeded: true,
                globalRefsCacheSrcFound: globalRefsCacheToUse,
                linkReferenceCache: [],
            };
            buildMapOfIteratedFiles.set(src, buildMapOfIteratedFilesToUse);
            
            indexOptimizationStats.totalFiles++;
            if (skipNote) {
                // console.log("**** SNW: buildLinksAndReferences > skipNote", src);
                buildMapOfIteratedFilesToUse.updateIndexNeeded = false;
                buildMapOfIteratedFiles.set(src, buildMapOfIteratedFilesToUse);
                return;
            }
        }

        if (!globalRefsCacheToUse) {
            console.log(
                "SNW: buildLinksAndReferences > globalRefsCacheToUse > NOT FOUND > This should NOT actually happen!"
            );
            return;
        }

        // console.log('ctr', ctr);
        // console.time('SNW: buildLinksAndReferences > parseLinktext');
        const refsLinkLookup = globalRefsCache.refLinkResolutionCache.get(refs.link);
        const resolvedFilePath = !refsLinkLookup
            ? parseLinktext(refs.link)
            : refsLinkLookup.resolvedFilePath;

        // console.timeEnd('SNW: buildLinksAndReferences > parseLinktext');
        // console.log("resolvedFilePath", resolvedFilePath);
        // spm: maybe removing the replace will save some time using some other way to get the file name
        if (resolvedFilePath.path === "") resolvedFilePath.path = src.replace(".md", "");
        if (!refsLinkLookup) {
            globalRefsCache.refLinkResolutionCache.set(refs.link, {
                resolvedFilePath,
            });
            indexOptimizationStats.refsLinkLookup++;
        } else {
            indexOptimizationStats.skippedFoundLinks++;
        }
        const refLinkResolutionCache = refsLinkLookup
            ? refsLinkLookup
            : globalRefsCache.refLinkResolutionCache.get(refs.link);
        if (!refLinkResolutionCache) {
            // mainly used for type narrowing
            console.log(
                "SNW: buildLinksAndReferences > refLinkResolutionCache > NOT FOUND > This should NOT actually happen!"
            );
            return;
        }
        // console.time('SNW: buildLinksAndReferences > resolvedFilePathIf');

        if (resolvedFilePath?.path) {
            const resolvedTFile =
                refLinkResolutionCache.resolvedTFile ??
                thePlugin.app.metadataCache.getFirstLinkpathDest(
                    resolvedFilePath.path,
                    "/"
                );
            // console.log("resolvedTFile", resolvedTFile);
            const resolvedTFileIsNull = !resolvedTFile;
            // console.log("resolvedTFileIsNull", resolvedTFileIsNull);
            if (resolvedTFile && !refLinkResolutionCache.resolvedTFile)
                refLinkResolutionCache.resolvedTFile = resolvedTFile;
            // console.log("resolvedTFile", resolvedTFile);
            const fileLink =
                refLinkResolutionCache.fileLink ??
                (resolvedTFileIsNull
                    ? ""
                    : resolvedTFile.path.replace(".md", "") +
                      stripHeading(resolvedFilePath.subpath)); // file doesnt exist, empty link
            if (!refLinkResolutionCache.fileLink) {
                refLinkResolutionCache.fileLink = fileLink;
                refLinkResolutionCache.fileLinkIgnored =
                    thePlugin.app.metadataCache.isUserIgnored(fileLink);
            }

            const ghlink =
                refLinkResolutionCache.ghlink ??
                (resolvedTFileIsNull ? resolvedFilePath.path : ""); // file doesnt exist, its a ghost link
            if (!refLinkResolutionCache.ghlink) refLinkResolutionCache.ghlink = ghlink;
            const sourceFile = globalRefsCacheToUse.srcFile;

            if (thePlugin.settings.enableIgnoreObsExcludeFoldersLinksFrom) {
                if (globalRefsCacheToUse.srcFileIgnored) {
                    indexOptimizationStats.totalFilesIgnored++;
                    return;
                }
            }

            if (thePlugin.settings.enableIgnoreObsExcludeFoldersLinksTo) {
                if (refLinkResolutionCache.fileLinkIgnored) {
                    indexOptimizationStats.totalLinksIgnored++;
                    return;
                }
            }

            const finalLinkResolution = {
                reference: {
                    displayText: refs.displayText ?? "",
                    // link: refs.link, // old approach
                    link: fileLink != "" ? fileLink : ghlink,
                    position: refs.position,
                },
                resolvedFile: resolvedTFile,
                ghostLink: ghlink,
                realLink: refs.link,
                sourceFile: sourceFile,
                excludedFile: false,
            };
            // globalRefsCacheToUse.linkReferenceCache.push(finalLinkResolution);
            buildMapOfIteratedFilesToUse.linkReferenceCache.push(finalLinkResolution);
            indexOptimizationStats.finalLinksResolution++;
            buildMapOfIteratedFiles.set(src, buildMapOfIteratedFilesToUse);
            globalRefsCache.refLinkResolutionCache.set(refs.link, refLinkResolutionCache);
        }
        // console.timeEnd('SNW: buildLinksAndReferences > resolvedFilePathIf');
    });
    console.timeEnd("SNW: buildLinksAndReferences > app.metadataCache.iterateReferences");

    console.time('SNW: buildLinksAndReferences > buildMapOfIteratedFiles.forEach');
    // loop through the buildMapOfIteratedFiles and update the globalRefsCacheMap
    buildMapOfIteratedFiles.forEach((value, key) => {
        if(value.updateIndexNeeded===false) return;
        const findGlobalRefsCacheMapSrcFile = globalRefsCache.globalRefsCacheMap.get(key);
        if (findGlobalRefsCacheMapSrcFile) {
            findGlobalRefsCacheMapSrcFile.linkReferenceCache = value.linkReferenceCache;
            findGlobalRefsCacheMapSrcFile.srcFileStats = {
                ctime: findGlobalRefsCacheMapSrcFile.srcFile.stat.ctime,
                mtime: findGlobalRefsCacheMapSrcFile.srcFile.stat.mtime,
                size: findGlobalRefsCacheMapSrcFile.srcFile.stat.size,
            };
            globalRefsCache.globalRefsCacheMap.set(key, findGlobalRefsCacheMapSrcFile);
        }
    })
    console.timeEnd('SNW: buildLinksAndReferences > buildMapOfIteratedFiles.forEach');

    // START: Remove file exclusions for frontmatter snw-index-exclude
    console.time('SNW: buildLinksAndReferences > snwIndexExceptionsList');
    const snwIndexExceptionsList = Object.entries(thePlugin.app.metadataCache.metadataCache).filter((e)=>{
        return e[1]?.frontmatter?.["snw-index-exclude"]
    });
    console.timeEnd('SNW: buildLinksAndReferences > snwIndexExceptionsList');
    console.time('SNW: buildLinksAndReferences > snwIndexExceptions2');
    // TODO: should resolve these ts-expect-errors by declaring the types for non-exposed API items
    // @ts-expect-error - fileCache is not exposed in the API
    const snwIndexExceptions = Object.entries(thePlugin.app.metadataCache.fileCache).filter((e)=>{
        // @ts-expect-error - fileCache is not exposed in the API
        return snwIndexExceptionsList.find(f=>f[0]===e[1].hash);
    });
    console.timeEnd('SNW: buildLinksAndReferences > snwIndexExceptions2');

    console.time('SNW: buildLinksAndReferences > allLinkResolutions');
    globalRefsCache.globalRefsCacheMap.forEach((value) => {
        const linkReferenceCache = value.linkReferenceCache;
        if(linkReferenceCache.length===0) return;
        allLinkResolutions.push(...linkReferenceCache);
        indexOptimizationStats.allLinksResolution += linkReferenceCache.length;
    });
    for (let i = 0; i < allLinkResolutions.length; i++) {
        allLinkResolutions[i].excludedFile = false;
        if(allLinkResolutions[i]?.resolvedFile?.path){
            const fileName = allLinkResolutions[i].resolvedFile?.path ?? '';
            for (let e = 0; e < snwIndexExceptions.length; e++) {
                if(fileName==snwIndexExceptions[e][0]) {
                    allLinkResolutions[i].excludedFile = true;
                    break;
                }
            }
        } 
    }
    // END: Exclusions
    console.timeEnd('SNW: buildLinksAndReferences > allLinkResolutions');



    console.time('SNW: buildLinksAndReferences > reduce');
    const refs = allLinkResolutions.reduce((acc: {[x:string]: Link[]}, link : Link): { [x:string]: Link[] } => {
        let keyBasedOnLink = "";
        // let keyBasedOnFullPath = ""

        keyBasedOnLink = link.reference.link;
        // if(link?.resolvedFile)
        //     keyBasedOnFullPath = link.resolvedFile.path.replace(link.resolvedFile.name,"") + link.reference.link;
        // else
        //     keyBasedOnFullPath = link.ghostLink;

        // if(keyBasedOnLink===keyBasedOnFullPath) {
        //     keyBasedOnFullPath=null;
        // }

        if(!acc[keyBasedOnLink]) {  
            acc[keyBasedOnLink] = [];
        }
        acc[keyBasedOnLink].push(link);

        // if(keyBasedOnFullPath!=null) {
        //     if(!acc[keyBasedOnFullPath]) {
        //         acc[keyBasedOnFullPath] = [];
        //     }
        //     acc[keyBasedOnFullPath].push(link)
        // } 
        return acc;
    }, {});
    console.timeEnd('SNW: buildLinksAndReferences > reduce');


    references = refs;
    // @ts-ignore
    window.snwAPI.references = references;
    lastUpdateToReferences = Date.now();
    console.timeEnd('SNW: buildLinksAndReferences');
    console.log("SNW: buildLinksAndReferences > indexOptimizationStats", indexOptimizationStats);
}


// following MAP works as a cache for the getCurrentPage call. Based on time elapsed since last update, it just returns a cached transformedCache object
const cacheCurrentPages = new Map<string,TransformedCache>();

/**
 * Provides an optimized view of the cache for determining the block count for references in a given page
 *
 * @export
 * @param {TFile} file
 * @return {*}  {TransformedCache}
 */
export function getSNWCacheByFile(file: TFile): TransformedCache {
    
    if(cacheCurrentPages.has(file.path)) {
        const cachedPage = cacheCurrentPages.get(file.path);
        if(cachedPage) {
            const cachedPageCreateDate = cachedPage.createDate ?? 0;
            // Check if references have been updated since last cache update, and if cache is old
            if( (lastUpdateToReferences < cachedPageCreateDate) && ((cachedPageCreateDate + thePlugin.settings.cacheUpdateInMilliseconds) > Date.now()) ) {
                return cachedPage;
            }
        }
    }

    if(thePlugin.showCountsActive!=true) return {};

    const transformedCache: TransformedCache = {};
    const cachedMetaData = thePlugin.app.metadataCache.getFileCache(file);
    if (!cachedMetaData) {
        return transformedCache;
    }

    if (!references) {
        console.log("SNW: getSNWCacheByFile > references not built yet > THIS SHOULD RARELY HAPPEN IF EVER");
        buildLinksAndReferences('full');
    }

    const headings: string[] = Object.values(thePlugin.app.metadataCache.metadataCache).reduce((acc : string[], file : CachedMetadata) => {
        const headings = file.headings;
        if (headings) {
            headings.forEach((heading : HeadingCache) => {
                acc.push(heading.heading);
            });
        }
        return acc;
    }, []);


    if (cachedMetaData?.blocks) {
        const filePath = file.path.replace(".md","");
        transformedCache.blocks = Object.values(cachedMetaData.blocks).map((block) => ({
            key: filePath + block.id,
            pos: block.position,
            page: file.basename,
            type: "block",
            references: references[ filePath + block.id ] || []
        }));
    }

    if (cachedMetaData?.headings) {
        transformedCache.headings = cachedMetaData.headings.map((header: {heading: string; position: Pos; level: number;}) => ({
            original: "#".repeat(header.level) + " " + header.heading,
            key: `${file.path.replace(".md","")}${stripHeading(header.heading)}`, 
            headerMatch: header.heading,
            headerMatch2: file.basename + "#" + header.heading,
            pos: header.position,
            page: file.basename,
            type: "heading",
            references: references[`${file.path.replace(".md","")}${stripHeading(header.heading)}`] || []
        }));
    }

    if (cachedMetaData?.links) {
        transformedCache.links = cachedMetaData.links.map((link) => {
            let newLinkPath = parseLinkTextToFullPath(link.link);

            if(newLinkPath==="") { // file does not exist, likely a ghost file, so just leave the link
                newLinkPath = link.link
            } 

            if(newLinkPath.startsWith("#^") || newLinkPath.startsWith("#") )  { // handles links from same page
                newLinkPath = file.path.replace(".md","") + stripHeading(newLinkPath);
            }

            return {
                key: newLinkPath,
                original: link.original,
                type: "link",
                pos: link.position,
                page: file.basename,
                references: references[newLinkPath] || []
            };
        });
        if (transformedCache.links) {
            transformedCache.links = transformedCache.links.map((link) => {
                if (link.key.includes("#") && !link.key.includes("#^")) {
                    const heading = headings.filter((heading : string) => stripHeading(heading) === link.key.split("#")[1])[0];
                    link.original = heading ? heading : undefined;
                }
                return link;
            });            
        }
    }

    if (cachedMetaData?.embeds) {
        transformedCache.embeds = cachedMetaData.embeds.map((embed) => {
            let newEmbedPath = parseLinkTextToFullPath(embed.link)

            // if newEmbedPath is empty, then this is a link on the same page
            if(newEmbedPath==="" && (embed.link.startsWith("#^") || embed.link.startsWith("#")) )  {
                newEmbedPath = file.path.replace(".md","") + stripHeading(embed.link);
            }

            const output = {
                key: newEmbedPath,
                page: file.basename,
                type: "embed",
                pos: embed.position,
                references: references[newEmbedPath] || []
            };
            return output;
        });
        if (transformedCache.embeds) {
            transformedCache.embeds = transformedCache.embeds.map((embed) => {
                if (embed.key.includes("#") && !embed.key.includes("#^") && transformedCache.headings) {
                    const heading = headings.filter((heading : string) => heading.includes(embed.key.split("#")[1]))[0];
                    embed.original = heading ? heading : undefined;
                }

                if (embed.key.startsWith("#^") || embed.key.startsWith("#")) {
                    embed.key = `${file.basename}${embed.key}`;
                    embed.references = references[embed.key] || [];
                }
                return embed;
            });
        }
    }
    
    transformedCache.cacheMetaData = cachedMetaData;
    transformedCache.createDate = Date.now();
    cacheCurrentPages.set(file.path, transformedCache);

    return transformedCache;
}

export function parseLinkTextToFullPath(link: string): string {
    const resolvedFilePath = parseLinktext(link);
    const resolvedTFile = thePlugin.app.metadataCache.getFirstLinkpathDest(resolvedFilePath.path, "/");
    if(resolvedTFile===null)
        return "";
    else
        return resolvedTFile.path.replace(".md","") + stripHeading(resolvedFilePath.subpath);    
}
