'use strict';

// Load modules

const Joi = require('../');


// Declare internals

const internals = {};


const schema = Joi.object().options({ abortEarly: false }).keys({
    email: Joi.string().email().required().label('User Email'),
    password: Joi.string().min(8).required(),
    password_confirmation: Joi.any().valid(Joi.ref('password')).required().options({ language: { 'any.allowOnly': 'must match password' } }).label('Password Confirmation'),
    first_name: Joi.string().required(),
    last_name: Joi.string().required(),
    company: Joi.string().optional()
});


const data = {
    email: 'not_a_valid_email_to_show_custom_label',
    password: 'abcd1234',
    password_confirmation: 'abc1',
    first_name: 'Joe',
    last_name: 'Doe'
};

Joi.assert(data, schema);
