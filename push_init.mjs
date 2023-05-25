// push_init.js

// Demonstrate clearing local call-history and closing services/messages/directories UIs, 
// using HTTP POST.

// Requires Node v18 for built-in fetch

import ejs from 'ejs';

// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config();

const device_ip = process.env.PUSH_PHONE_ADDRESS;
// Construct Basic Auth string by base64 encoding username:password
const auth_string = btoa(`${process.env.PUSH_APP_USER_NAME}:${process.env.PUSH_APP_USER_PASSWORD}`)

const push_uris = [
    'Init:CallHistory',
    'Init:Messages',
    'Init:Directories',
    'Init:Services'
];

// For each push URI...
push_uris.forEach(async item => {
    // POST the XML body (rendered via EJS from template+variable)
    try {
        const response = await fetch(`http://${device_ip}/CGI/Execute`, {
            method: 'POST',
            body: await ejs.renderFile('views/push_init/execute.ejs', { execute_uri: item }),
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Authorization': `Basic ${auth_string}`
            }
        });
        if (!response.ok) {
            console.log(`Error pushing ${item}: ${response.status}/${response.statusText}`);
            process.exit(1);
        }
        const body = await response.text();
        if (body == '<CiscoIPPhoneError Number=\"4\" />') {
            console.log(`\nError pushing ${item}: user un-authorized`);
            process.exit(1);
        }
        console.log(`${item} - Success!`)
    }
    catch (e) {
        console.log(`Error pushing ${item}: ${e.cause}`);
        process.exit(1);
    }

    // Wait 1 sec before sending the next push
    await new Promise(resolve => setTimeout(resolve, 1000));
});

