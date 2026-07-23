// Public half of the RSA keypair used to sign Lifetime Offline license activation
// tokens (private key lives server-side only, in server/.env). Used to verify a
// cached token's signature entirely offline — never needs the network.
module.exports = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAzF+CJH72g14WLoX7zCNp
hbpetz9Rhy7xWhgQ4nPnWDgMqfKmJ4T44/+/sgB92WCOWvqu2qhUa2iydvo3Kv2s
5FLR6i2BM7BCjriSTWF/OpG1S6CafXrwNcF9xjLit3KIOj2eqCptFUTa7v51EVHA
Ud4krwGOSrvPB9rEypPOLVtqFK5r0FoblNDk8uewmEImvMvuTqTHAKuRmVr8daf5
TTsEUArGSR3sG2fqvWxPbqZvaxIsmiNsfY73AbkqqPxs1R8A6Uc3d8wfM5pW6gCB
4g7lBL9RkMbfDqaihKTT36sNEvDYAU7/91rvk90lyUHxG9PH8elBWqR//y+8daPa
MwIDAQAB
-----END PUBLIC KEY-----`;
