'use strict';

var gulp      = require('gulp');
var fs        = require('fs');
var pkg       = require('./package.json');
var iopackage = require('./io-package.json');
var version   = (pkg && pkg.version) ? pkg.version : iopackage.common.version;
/*var appName   = getAppName();
function getAppName() {
    var parts = __dirname.replace(/\\/g, '/').split('/');
    return parts[parts.length - 1].split('.')[0].toLowerCase();
}
*/
const fileName = 'words.js';
var languages =  {
    en: {},
    de: {},
    ru: {},
    pt: {},
    nl: {},
    fr: {},
    it: {},
    es: {},
    pl: {}
};

function lang2data(lang, isFlat) {

}

function readWordJs(src) {
  
}
function padRight(text, totalLength) {

}
function writeWordJs(data, src) {

}

const EMPTY = '';

function words2languages(src) {

}
function words2languagesFlat(src) {

}
function languagesFlat2words(src) {

}
function languages2words(src) {

}

gulp.task('adminWords2languages', function (done) {
    words2languages('./admin/');
    done();
});

gulp.task('adminWords2languagesFlat', function (done) {
    words2languagesFlat('./admin/');
    done();
});

gulp.task('adminLanguagesFlat2words', function (done) {
    languagesFlat2words('./admin/');
    done();
});

gulp.task('adminLanguages2words', function (done) {
    languages2words('./admin/');
    done();
});


gulp.task('updatePackages', function (done) {

});

gulp.task('updateReadme', function (done) {
   
});

gulp.task('default', ['updatePackages', 'updateReadme']);
