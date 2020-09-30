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

const appBaseUrl=`${process.env.APP_PROTOCOL}://${process.env.APP_ADDRESS}:${process.env.APP_PORT}`

// Create the Express app object
const app = express();

// Initialize Express session storage with a unique secret
app.use(session({
    secret: uuidv4(),
    resave: false,
    saveUninitialized: false
}));

// Configure LDAP details in .env
const ldapUser = process.env.LDAP_USER;
const ldapPassword = process.env.LDAP_PASSWORD;

// Serve static pages/resources from /public
app.use(express.static('public'))

// set the view engine to ejs
app.set('view engine', 'ejs');

// Start - Express routes

// Return a listing as <CiscoIPPhoneDirectory>
app.get('/search', async (req, res) => {
    res.set({'Content-Type': 'text/xml'});
    res.status(200).render('ldap_directory_search.ejs',{searchUrl: appBaseUrl+'/list'});
});


app.get('/list', async function (req, res) {

    let start = req.query.start ? parseInt(req.query.start) : null;

    let userList;

    // A 'start' query param indicates this is paging on search
    // stored in the session
    if (start) userList = req.session.userList
    else {
        var client = ldap.createClient({
            url: `ldap://${process.env.LDAP_ADDRESS}:${process.env.LDAP_PORT}`
        });

        if (process.env.LDAP_USER && process.env.LDAP_PASSWORD) {
            client.bind(process.env.LDAP_USER, process.env.LDAP_PASSWORD, (err) => {
                if (err) console.log(`Bind error: ${err}`);
            });
        }

        let firstNameFilter = req.query.f ? `(givenName=${req.query.f}*)` : '';
        let lastNameFilter = req.query.l ? `(sn=${req.query.l}*)` : '';
        let numberFilter = req.query.n ? `(telephoneNumber=*${req.query.n}*)` : '(telephoneNumber=*)';
        let filter = `(&(objectClass=inetOrgPerson)${firstNameFilter}${lastNameFilter}${numberFilter})`;
        let options = {
            filter: filter,
            attributes: ['givenName','sn','telephoneNumber'],
            scope: 'sub'
        }

        let search = function(searchBase, options) {
            return new Promise((resolve, reject) => {
                client.search(searchBase, options, (err, ldapRes) => {
                    if (err) reject(err);
                    let userList = [];
                    ldapRes.on('searchEntry', entry => {
                        userList.push({
                            lastName: entry.object.sn,
                            firstName: entry.object.givenName,
                            number: entry.object.telephoneNumber
                        });
                    });
                    ldapRes.on('end', result => resolve(userList));
                    ldapRes.on('error', err => reject(err));
                });
            });
        }

        userList = await search(process.env.LDAP_SEARCH_BASE, options);
        req.session.userList=userList;
    }

    start = start ? start : 1;
    let total = userList.length;
    let count = (total-start+1);
    let resultsPerPage = process.env.RESULTS_PER_PAGE ? parseInt(process.env.RESULTS_PER_PAGE) : 32;
    let next = null;
    if (count>resultsPerPage){
        count=resultsPerPage;
        next = start+count;
    }

    res.set({'Content-Type': 'text/xml'});

    if (total==0) res.status(200).render('ldap_directory_no_results.ejs')
    else {
        if (next) res.set({'Refresh': `0; url=${appBaseUrl}/list?start=${next}`});
        res.status(200).render('ldap_directory_list.ejs',{
            userList: userList,
            start: start,
            count: count,
            total: total,
            next: next
        });
    }

});

// Starts the app with HTTPS certificate and key
// https.createServer( {
//     key: fs.readFileSync( 'server.key' ),
//     cert: fs.readFileSync( 'server.cert' )
//   },
//   app
// )
app.listen(process.env.APP_PORT,() => {
    console.log(`CUCM directory server started on ${appBaseUrl}`);
});

