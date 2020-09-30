// Copyright (c) 2020 Cisco Systems
// Licensed under the MIT License

const express = require('express');
const session = require('express-session');
const ejs = require('ejs');
const join = require('path').join;
const { v4: uuidv4 } = require('uuid');
const ldap = require('ldapjs');
const util = require('util');
const { count } = require('console');

// Load process.env values from .env file
require('dotenv').config();

const appBaseUrl = `${process.env.APP_PROTOCOL}://${process.env.APP_ADDRESS}:${process.env.APP_PORT}`

// Create the Express app object
const app = express();

// Initialize Express session storage with a unique secret
app.use(session({
    secret: uuidv4(),
    resave: false,
    saveUninitialized: false
}));

// Configure LDAP details in .env
const ldapUser = process.env.LDAP_USER_DN;
const ldapPassword = process.env.LDAP_PASSWORD;

// Function to return a <CiscoIPPhoneText> object with either default
// or detailed error details based on configuration
function returnErrorText(res,err){
    let message = (process.env.SHOW_ERROR_DETAIL=='True') ? err.message : 'An error occurred, please contact your system administrator';
    res.set({ 'Content-Type': 'text/xml' });
    res.status(200).render('ldap_directory/text.ejs',{
        title: 'Error',
        text: message
    });
}

// Serve static pages/resources from /public
app.use(express.static('public'))

// set the view engine to ejs
app.set('view engine', 'ejs');

// Start - Express routes

// Return a listing as <CiscoIPPhoneDirectory>
app.get('/search', async (req, res) => {
    res.set({ 'Content-Type': 'text/xml' });
    res.status(200).render('ldap_directory/input.ejs', { searchUrl: appBaseUrl + '/list' });
});


app.get('/list', async function (req, res) {

    res.set({ 'Content-Type': 'text/xml' });

    let firstNameFilter = req.query.f ? `(givenName=${req.query.f}*)` : '';
    let lastNameFilter = req.query.l ? `(sn=${req.query.l}*)` : '';
    // Return only records with a telephoneNumber value by default
    let numberFilter = req.query.n ? `(telephoneNumber=*${req.query.n}*)` : '(telephoneNumber=*)';
    let start = req.query.start ? parseInt(req.query.start) : null;

    // If there are no query parameters on the search request,
    // return if configuration disallows empty searches
    if ((process.env.ALLOW_EMPTY_SEARCH=='False')&&(Object.keys(req.query).length==0)) {
        res.status(200).render('ldap_directory/text.ejs',{
            title: "Search invalid",
            text: "At least one search criteria must be entered"
        });
        return;
    }

    let userList;

    // A 'start' query param indicates this is a paging request for
    // a previous search stored in the session
    if (start) userList = req.session.userList
    // Else start the process to perform a new LDAP query
    else {

        var client;

        var client = ldap.createClient({
            url: `ldap://${process.env.LDAP_ADDRESS}:${process.env.LDAP_PORT}`
        });

        // Handle general client error conditions by reporting to the console
        client.on('error', err => console.error(`Client connection error: ${err}`));

        // If a LDAP user password is configured, attempt to bind/authenticate
        if (process.env.LDAP_USER_DN && process.env.LDAP_PASSWORD) {
            const result = await (async ()=>{
                return new Promise((resolve,reject) => {
                    client.bind(process.env.LDAP_USER_DN, process.env.LDAP_PASSWORD, (err) => {
                        if (err) reject(err);
                        else resolve(true);
                    });
                });
            })()
            .catch( err => {
                console.error(`LDAP bind error: ${err}`);
                returnErrorText(res,err);
            });
            if (!result) return;
        }

        // Construct LDAP filters based on configuration and incoming query params
        let defaultFilter = process.env.DEFAULT_FILTER;
        let filter = `(&${defaultFilter}${firstNameFilter}${lastNameFilter}${numberFilter})`;

        // Todo add a config option to specify alternative attributes names for first/last/phone
        let options = {
            filter: filter,
            attributes: ['givenName', 'sn', 'telephoneNumber'],
            scope: 'sub'
        }

        // Launch the search request.  Wrapping the ldapjs callback-style function
        // in an awaited promise to ensure we get results synchronously
        userList = await (async function() {
            return new Promise((resolve, reject) => {
                client.search(process.env.LDAP_SEARCH_BASE, options, (err, ldapRes) => {
                    if (err) return reject(err);
                    let userList = [];
                    // The ldapjs API provides results as sub-events
                    ldapRes.on('searchEntry', entry => {
                        // Push entry data as objects into the userList
                        userList.push({
                            lastName: entry.object.sn ? entry.object.sn : '',
                            firstName: entry.object.givenName ? entry.object.givenName : '',
                            number: entry.object.telephoneNumber
                        });
                    });
                    // 'end' event will be received when no more entries are forthcoming
                    ldapRes.on('end', result => resolve(userList));
                    // Errors can occur while searching/retrieving records.
                    // Set userList back to null in case we were in the middle of retrieving
                    ldapRes.on('error', err => {
                        userList = null;
                        reject(err);
                    });
                });
            });
        })()
        .catch(err=>{
            console.error(`LDAP search error: ${err}`);
            returnErrorText(res,err);
        });
        if (!userList) return;

        // Sort the array by firstName, and then by lastName
        userList.sort((a, b) => (a.firstName > b.firstName) ? 1 : ((b.firstName > a.firstName) ? -1 : 0));
        userList.sort((a, b) => (a.lastName > b.lastName) ? 1 : ((b.lastName > a.lastName) ? -1 : 0));

        // Store the userList array in the session object for later paged requests
        req.session.userList = userList;
    }

    // Calculate the total,count for this page,start and next values
    start = start ? start : 1;
    let total = userList.length;
    let count = (total - start + 1);
    let resultsPerPage = process.env.RESULTS_PER_PAGE ? parseInt(process.env.RESULTS_PER_PAGE) : 32;
    let next = null;
    if (count > resultsPerPage) {
        count = resultsPerPage;
        next = start + count;
    }

    if (total == 0) res.status(200).render('ldap_directory/text.ejs',{
        title: 'Search Results',
        text: 'No matching records found'
    })
    else {
        // The <CiscoIPPhoneDirectory> object will display a 'Next' softkey if
        // we set the Refresh header to point to the next page of entires
        if (next) res.set({ 'Refresh': `0; url=${appBaseUrl}/list?start=${next}` });
        res.status(200).render('ldap_directory/directory.ejs', {
            userList: userList,
            start: start,
            count: count,
            total: total,
            next: next
        });
    }

});

// Todo, implement serving via HTTPS
// Starts the app with HTTPS certificate and key
// https.createServer( {
//     key: fs.readFileSync( 'server.key' ),
//     cert: fs.readFileSync( 'server.cert' )
//   },
//   app
// )
app.listen(process.env.APP_PORT, () => {
    console.log(`ldap_directory server started on ${appBaseUrl}`);
});

