/**
 * Simulación de Interfaz mediante JSDoc
 * @typedef {Object} ProfileData
 * @property {number|string} id
 * @property {string} nickname
 * @property {string} username
 * @property {string} picture
 * @property {string} header
 * @property {string} url
 */

class Profile {
    /**
     * @param {ProfileData} data
     */
    constructor({ id, nickname, username, picture, header = '', url }) {
        this.id = id;
        this.nickname = nickname;
        this.username = username 
            ? String(username).replace(/^@/, '') 
            : '';
        this.picture = picture;
        this.header = header;
        this.url = url;
    }
    isValid() {
        return !!(this.id && this.username && this.picture);
    }
}

module.exports = Profile;